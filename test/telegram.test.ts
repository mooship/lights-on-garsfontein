import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { MINUTE_MS } from '../shared/api';
import { admin } from '../src/admin/copy';
import { MINUTE_CRON } from '../worker/crons';
import { createDb } from '../worker/db/client';
import worker from '../worker/index';
import {
  ALERT_DELAY_MS,
  type AlertJob,
  claimAlerts,
  enqueueAlerts,
  PUSH_MAX_ATTEMPTS,
  type TelegramAlert,
} from '../worker/lib/alerts';
import { deliverTelegramAlert, TELEGRAM_HOST, telegramConfigured, telegramText } from '../worker/lib/telegram';
import { insertOutage, insertSubscription, runCron, stubFetchHost } from './helpers';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DUE_MS = ALERT_DELAY_MS + MINUTE_MS;
const TOKEN = '123456:test-bot-token';
const CHAT_ID = '42';

const telegramEnv = (queue: Queue<AlertJob> = env.PUSH_QUEUE): Env => ({
  ...env,
  PUSH_QUEUE: queue,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_CHAT_ID: CHAT_ID,
});

const { telegram } = admin;
const off = { startTime: '2026-10-22T12:02:00Z', endTime: null, isPlanned: false, source: 'sensor' } as const;
const back = { ...off, endTime: '2026-10-22T14:15:00Z' };
const sameDay = new Date('2026-10-22T14:20:00Z');

describe('telegramText', () => {
  it('says only what is known when the sensor falls silent', () => {
    expect(telegramText('off', off, sameDay)).toBe(telegram.off.sensor('14:02'));
    // One literal smoke string.
    expect(telegramText('off', off, sameDay)).toBe('No reading from home since 14:02. The power may be off.');
  });

  it('says the power is off for an outage logged by hand', () => {
    expect(telegramText('off', { ...off, source: 'manual' }, sameDay)).toBe(telegram.off.manual('14:02'));
  });

  it('marks a planned outage', () => {
    expect(telegramText('off', { ...off, isPlanned: true }, sameDay)).toBe(
      telegram.planned + telegram.off.sensor('14:02'),
    );
  });

  it('says when the power came back and for how long', () => {
    expect(telegramText('on', back, sameDay)).toBe(telegram.on('16:15', '2 h 13 min'));
  });

  it('gives the sensor outage times in a false alarm', () => {
    expect(telegramText('dismissed', back, sameDay)).toBe(telegram.dismissed.sensor('14:02', '16:15'));
  });

  it('says only that the power stayed on when the times would claim too much', () => {
    expect(telegramText('dismissed', off, sameDay)).toBe(telegram.dismissed.plain);
    expect(telegramText('dismissed', { ...back, source: 'manual' }, sameDay)).toBe(telegram.dismissed.plain);
  });

  it('adds the date to a time on another day', () => {
    const nextDay = new Date('2026-10-23T08:00:00Z');

    expect(telegramText('on', back, nextDay)).toBe(telegram.on('22 Oct 16:15', '2 h 13 min'));
  });
});

describe('telegramConfigured', () => {
  it('needs both secrets', () => {
    expect(telegramConfigured(telegramEnv())).toBe(true);
    expect(telegramConfigured({ ...telegramEnv(), TELEGRAM_CHAT_ID: '' })).toBe(false);
    expect(telegramConfigured({ ...telegramEnv(), TELEGRAM_BOT_TOKEN: '' })).toBe(false);
    expect(telegramConfigured(env)).toBe(false);
  });
});

function stubQueue() {
  const sendBatch = vi.fn(async (_messages: Iterable<MessageSendRequest<AlertJob>>) => {});
  return { queue: { sendBatch } as unknown as Queue<AlertJob>, sendBatch };
}
const sentBodies = (sendBatch: ReturnType<typeof stubQueue>['sendBatch']) =>
  sendBatch.mock.calls.flatMap(([messages]) => [...messages].map((message) => message.body));

describe('queueing Telegram alerts', () => {
  const db = () => createDb(env.DB);
  const claim = { kind: 'off', outageId: 7 } as const;

  it('queues one Telegram message per claim, even without push subscribers', async () => {
    const { queue, sendBatch } = stubQueue();

    await enqueueAlerts(db(), queue, [claim], NOW, { telegram: true });

    expect(sentBodies(sendBatch)).toEqual([{ ...claim, channel: 'telegram', attempt: 1, queuedAt: NOW.toISOString() }]);
  });

  it('queues no Telegram message unless asked to', async () => {
    await insertSubscription('a');
    const { queue, sendBatch } = stubQueue();

    await enqueueAlerts(db(), queue, [claim], NOW);

    expect(sentBodies(sendBatch).some((body) => 'channel' in body)).toBe(false);
  });

  it('releases the claim when queueing fails, so the next run tries again', async () => {
    const id = await insertOutage({ startTime: ago(DUE_MS) });
    const claims = await claimAlerts(db(), NOW);
    const sendBatch = vi.fn().mockRejectedValue(new Error('queue down'));

    await expect(
      enqueueAlerts(db(), { sendBatch } as unknown as Queue<AlertJob>, claims, NOW, { telegram: true }),
    ).rejects.toThrow('queue down');

    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'off', outageId: id }]);
  });

  it('is queued by the minute cron only when both secrets are set', async () => {
    await insertOutage({ startTime: ago(DUE_MS) });
    const unset = stubQueue();
    await runCron(MINUTE_CRON, NOW.getTime(), { ...env, PUSH_QUEUE: unset.queue });
    expect(unset.sendBatch).not.toHaveBeenCalled();

    await insertOutage({ startTime: ago(DUE_MS) });
    const set = stubQueue();
    await runCron(MINUTE_CRON, NOW.getTime(), telegramEnv(set.queue));
    expect(sentBodies(set.sendBatch)).toMatchObject([{ kind: 'off', channel: 'telegram' }]);
  });
});

describe('deliverTelegramAlert', () => {
  const alertFor = (outageId: number, overrides: Partial<TelegramAlert> = {}): TelegramAlert => ({
    kind: 'off',
    outageId,
    channel: 'telegram',
    attempt: 1,
    queuedAt: NOW.toISOString(),
    ...overrides,
  });
  const stubTelegram = (status: number | Error, body: unknown = { ok: status === 200 }) =>
    stubFetchHost(TELEGRAM_HOST, () => {
      if (status instanceof Error) throw status;
      return Response.json(body, { status });
    });
  const retryQueue = () => {
    const send = vi.fn(async (_body: AlertJob, _options?: QueueSendOptions) => {});
    return { send, queue: { send } as unknown as Queue<AlertJob> };
  };

  it('sends the text to the chat as plain text, without a link preview', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    const fetchSpy = stubTelegram(200);

    await deliverTelegramAlert(alertFor(outage), telegramEnv(), NOW);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(input)).toBe(`https://${TELEGRAM_HOST}/bot${TOKEN}/sendMessage`);
    expect(init?.method).toBe('POST');
    const sent = JSON.parse(String(init?.body));
    expect(sent).toEqual({
      chat_id: CHAT_ID,
      // DUE_MS before NOW, in local time.
      text: telegram.off.sensor('13:49'),
      link_preview_options: { is_disabled: true },
    });
  });

  it('sends nothing for an alert that no longer holds', async () => {
    const dismissed = await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1 });
    const fetchSpy = stubTelegram(200);

    await deliverTelegramAlert(alertFor(dismissed), telegramEnv(), NOW);
    await deliverTelegramAlert(alertFor(dismissed + 1000), telegramEnv(), NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing once the secrets are removed', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    const fetchSpy = stubTelegram(200);

    await deliverTelegramAlert(alertFor(outage), env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a 429', 429],
    ['a 5xx', 502],
    ['a failed fetch', new TypeError('network down')],
  ] as const)('retries after %s, waiting longer each time', async (_name, status) => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    stubTelegram(status);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, queue } = retryQueue();

    await deliverTelegramAlert(alertFor(outage, { attempt: 2 }), telegramEnv(queue), NOW);

    expect(send).toHaveBeenCalledOnce();
    const [body, options] = send.mock.calls[0] ?? [];
    expect(body).toEqual(alertFor(outage, { attempt: 3 }));
    expect(options?.delaySeconds).toBeGreaterThan(60);
  });

  it('gives up after PUSH_MAX_ATTEMPTS', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    stubTelegram(503);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, queue } = retryQueue();

    await deliverTelegramAlert(alertFor(outage, { attempt: PUSH_MAX_ATTEMPTS }), telegramEnv(queue), NOW);

    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("drops other errors and logs Telegram's description, never the token", async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    stubTelegram(400, { ok: false, description: 'Bad Request: chat not found' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, queue } = retryQueue();

    await deliverTelegramAlert(alertFor(outage), telegramEnv(queue), NOW);

    expect(send).not.toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('chat not found');
    expect(logged).not.toContain(TOKEN);
  });

  it('never logs the token when the fetch fails', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    stubTelegram(new TypeError(`fetch failed for https://${TELEGRAM_HOST}/bot${TOKEN}/sendMessage`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await deliverTelegramAlert(alertFor(outage), telegramEnv(retryQueue().queue), NOW);

    expect(warn.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });
});

describe('the queue handler', () => {
  it('sends a Telegram message, then acks it', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    const fetchSpy = stubFetchHost(TELEGRAM_HOST, () => Response.json({ ok: true }));
    const body: TelegramAlert = {
      kind: 'off',
      outageId: outage,
      channel: 'telegram',
      attempt: 1,
      queuedAt: new Date().toISOString(),
    };
    const message = { body, ack: vi.fn() };

    await worker.queue({ messages: [message] } as unknown as MessageBatch<AlertJob>, telegramEnv());

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
  });
});
