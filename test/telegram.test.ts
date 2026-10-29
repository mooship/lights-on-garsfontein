import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import backfill from '../drizzle/0014_telegram_alert_backfill.sql?raw';
import { HEARTBEAT_THRESHOLD_MS, MINUTE_MS } from '../shared/api';
import { admin } from '../src/admin/copy';
import { MINUTE_CRON } from '../worker/crons';
import { createDb } from '../worker/db/client';
import worker from '../worker/index';
import {
  ALERT_DELAY_MS,
  type AlertJob,
  claimAlerts,
  enqueueAlerts,
  enqueueTelegramAlerts,
  loadDueOutage,
  PUSH_MAX_ATTEMPTS,
  TELEGRAM_ALERT_DELAY_MS,
  TELEGRAM_CHANNEL,
  type TelegramAlert,
} from '../worker/lib/alerts';
import { deliverTelegramAlert, TELEGRAM_HOST, telegramConfigured, telegramText } from '../worker/lib/telegram';
import { expireTimeouts, insertOutage, insertSubscription, runCron, stubFetchHost } from './helpers';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DUE_MS = TELEGRAM_ALERT_DELAY_MS + MINUTE_MS;
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

const telegramColumns = async (id: number) =>
  env.DB.prepare(
    'SELECT off_alert_at, on_alert_at, telegram_off_alert_at, telegram_on_alert_at FROM outages WHERE id = ?',
  )
    .bind(id)
    .first<{
      off_alert_at: string | null;
      on_alert_at: string | null;
      telegram_off_alert_at: string | null;
      telegram_on_alert_at: string | null;
    }>();

describe('the Telegram delay', () => {
  it('is sooner than the push delay, and still above the time a silent sensor takes to be detected', () => {
    // Literal minutes on purpose: this pins the delay the owner chose, so changing it fails here.
    expect(TELEGRAM_ALERT_DELAY_MS).toBe(5 * MINUTE_MS);
    expect(TELEGRAM_ALERT_DELAY_MS).toBeLessThan(ALERT_DELAY_MS);
    expect(TELEGRAM_ALERT_DELAY_MS).toBeGreaterThan(HEARTBEAT_THRESHOLD_MS);
  });
});

describe('claiming Telegram alerts', () => {
  const db = () => createDb(env.DB);

  it('claims off at its own delay, while push is still waiting', async () => {
    const id = await insertOutage({ startTime: ago(6 * MINUTE_MS) });

    expect(await claimAlerts(db(), NOW)).toEqual([]);
    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([{ kind: 'off', outageId: id }]);

    expect(await telegramColumns(id)).toMatchObject({
      telegram_off_alert_at: NOW.toISOString(),
      off_alert_at: null,
    });
  });

  it('waits until the delay has passed', async () => {
    await insertOutage({ startTime: ago(TELEGRAM_ALERT_DELAY_MS - MINUTE_MS) });

    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([]);
  });

  it("claims independently of push, and never the other channel's column", async () => {
    const id = await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS) });

    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([{ kind: 'off', outageId: id }]);
    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([]);
    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'off', outageId: id }]);
    expect(await telegramColumns(id)).toMatchObject({
      off_alert_at: NOW.toISOString(),
      telegram_off_alert_at: NOW.toISOString(),
    });
  });

  it('tells Telegram off and back on for an outage that ends between the two delays, and push nothing', async () => {
    const id = await insertOutage({ startTime: ago(8 * MINUTE_MS) });
    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([{ kind: 'off', outageId: id }]);

    await env.DB.prepare('UPDATE outages SET end_time = ? WHERE id = ?').bind(ago(MINUTE_MS), id).run();

    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([{ kind: 'on', outageId: id }]);
    expect(await claimAlerts(db(), NOW)).toEqual([]);
    expect(await telegramColumns(id)).toMatchObject({ off_alert_at: null, on_alert_at: null });
  });

  it('follows up only an off alert that Telegram sent, not one that push sent', async () => {
    await insertOutage({
      startTime: ago(30 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      offAlertAt: ago(MINUTE_MS),
    });

    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([]);
  });

  it('claims dismissed for a false positive whose Telegram off alert was sent', async () => {
    const id = await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1, telegramOffAlertAt: ago(MINUTE_MS) });

    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([{ kind: 'dismissed', outageId: id }]);
    expect((await telegramColumns(id))?.telegram_on_alert_at).toBe(NOW.toISOString());
  });

  it('finds the outages awaiting a Telegram follow-up without scanning the table', async () => {
    const { results } = await env.DB.prepare(
      'EXPLAIN QUERY PLAN UPDATE outages SET telegram_on_alert_at = ? WHERE telegram_off_alert_at IS NOT NULL AND telegram_on_alert_at IS NULL',
    )
      .bind(NOW.toISOString())
      .all<{ detail: string }>();

    expect(results.map(({ detail }) => detail)).not.toContainEqual(expect.stringMatching(/^SCAN outages/));
  });
});

describe('queueing Telegram alerts', () => {
  const db = () => createDb(env.DB);
  const claim = { kind: 'off', outageId: 7 } as const;

  it('queues one Telegram message per claim, even without push subscribers', async () => {
    const { queue, sendBatch } = stubQueue();

    await enqueueTelegramAlerts(db(), queue, [claim], NOW);

    expect(sentBodies(sendBatch)).toEqual([{ ...claim, channel: 'telegram', attempt: 1, queuedAt: NOW.toISOString() }]);
  });

  it('queues no Telegram message for a push alert', async () => {
    await insertSubscription('a');
    const { queue, sendBatch } = stubQueue();

    await enqueueAlerts(db(), queue, [claim], NOW);

    expect(sentBodies(sendBatch).some((body) => 'channel' in body)).toBe(false);
  });

  it('releases only the Telegram claim when queueing fails, so the next run tries again', async () => {
    const id = await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS), offAlertAt: ago(MINUTE_MS) });
    const claims = await claimAlerts(db(), NOW, TELEGRAM_CHANNEL);
    const sendBatch = vi.fn().mockRejectedValue(new Error('queue down'));

    await expect(enqueueTelegramAlerts(db(), { sendBatch } as unknown as Queue<AlertJob>, claims, NOW)).rejects.toThrow(
      'queue down',
    );

    expect(await telegramColumns(id)).toMatchObject({ telegram_off_alert_at: null, off_alert_at: ago(MINUTE_MS) });
    expect(await claimAlerts(db(), NOW, TELEGRAM_CHANNEL)).toEqual([{ kind: 'off', outageId: id }]);
  });

  it('is queued by the minute cron only when both secrets are set', async () => {
    await insertOutage({ startTime: ago(DUE_MS) });
    const unset = stubQueue();
    await runCron(MINUTE_CRON, NOW.getTime(), { ...env, PUSH_QUEUE: unset.queue });
    expect(unset.sendBatch).not.toHaveBeenCalled();

    const set = stubQueue();
    await runCron(MINUTE_CRON, NOW.getTime(), telegramEnv(set.queue));
    expect(sentBodies(set.sendBatch)).toMatchObject([{ kind: 'off', channel: 'telegram' }]);
  });

  it('does not let a failing push queue hold back the Telegram message', async () => {
    await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS) });
    await insertSubscription('a');
    const sendBatch = vi.fn(async (messages: Iterable<MessageSendRequest<AlertJob>>) => {
      if ([...messages].some((message) => !('channel' in message.body))) throw new Error('push queue down');
    });

    await expect(
      runCron(MINUTE_CRON, NOW.getTime(), telegramEnv({ sendBatch } as unknown as Queue<AlertJob>)),
    ).rejects.toThrow('push queue down');

    expect(sentBodies(sendBatch)).toMatchObject(
      expect.arrayContaining([expect.objectContaining({ kind: 'off', channel: 'telegram' })]),
    );
  });
});

describe('a dismissal that is undone', () => {
  const db = () => createDb(env.DB);

  it("releases the Telegram claim for a Telegram job, and leaves push's alone", async () => {
    const id = await insertOutage({
      startTime: ago(DUE_MS),
      offAlertAt: ago(2 * MINUTE_MS),
      onAlertAt: ago(MINUTE_MS),
      telegramOffAlertAt: ago(2 * MINUTE_MS),
      telegramOnAlertAt: NOW.toISOString(),
    });

    const outage = await loadDueOutage(
      db(),
      { kind: 'dismissed', outageId: id, queuedAt: NOW.toISOString() },
      TELEGRAM_CHANNEL,
    );

    expect(outage).toBeNull();
    expect(await telegramColumns(id)).toMatchObject({
      telegram_on_alert_at: null,
      on_alert_at: ago(MINUTE_MS),
    });
  });
});

describe('the data migration', () => {
  it('copies an earlier push claim to Telegram, so an alerted outage is not alerted twice', async () => {
    const id = await insertOutage({
      startTime: ago(30 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      offAlertAt: ago(20 * MINUTE_MS),
      onAlertAt: ago(MINUTE_MS),
    });
    const untouched = await insertOutage({ startTime: ago(3 * MINUTE_MS) });
    const sql = backfill
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join(' ');

    await env.DB.prepare(sql).run();

    expect(await telegramColumns(id)).toMatchObject({
      telegram_off_alert_at: ago(20 * MINUTE_MS),
      telegram_on_alert_at: ago(MINUTE_MS),
    });
    expect(await telegramColumns(untouched)).toMatchObject({ telegram_off_alert_at: null });
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
      text: telegram.off.sensor('13:54'),
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

  it('retries when Telegram does not answer in time', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    stubTelegram(200);
    expireTimeouts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, queue } = retryQueue();

    await deliverTelegramAlert(alertFor(outage), telegramEnv(queue), NOW);

    expect(send).toHaveBeenCalledOnce();
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
