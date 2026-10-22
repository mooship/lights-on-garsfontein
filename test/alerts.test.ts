import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { MINUTE_MS } from '../shared/api';
import { site } from '../site.config';
import { DICTIONARIES } from '../src/i18n/index';
import { MINUTE_CRON } from '../worker/crons';
import { createDb } from '../worker/db/client';
import {
  ALERT_DELAY_MS,
  ALERT_KINDS,
  type AlertPage,
  alertMessage,
  claimAlerts,
  enqueueAlerts,
  PUSH_PAGE_SIZE,
} from '../worker/lib/alerts';
import { insertOutage, runCron } from './helpers';

const { af, en } = DICTIONARIES;

const off = { startTime: '2026-10-22T12:02:00Z', endTime: null, isPlanned: false };
const back = { ...off, endTime: '2026-10-22T14:15:00Z' };

describe('alertMessage', () => {
  it('says when the power went off, in local time', () => {
    const { body } = alertMessage('off', off, 'en');

    expect(body).toBe(en.push.off.body('14:02'));
    expect(body).toContain('14:02');
    // One literal smoke string per language.
    expect(body).toBe('No power in Garsfontein Ext. 16 since 14:02.');
    expect(alertMessage('off', off, 'af').body).toBe('Geen krag in Garsfontein Uitb. 16 sedert 14:02 nie.');
  });

  it('uses the planned wording for planned outages', () => {
    const message = alertMessage('off', { ...off, isPlanned: true }, 'en');

    expect(message.title).toBe(en.push.planned.title);
    expect(message.body).toBe(en.push.planned.body('14:02'));
  });

  it('says when it came back and for how long', () => {
    expect(alertMessage('on', back, 'en').body).toBe(en.push.on.body('16:15', '2 h 13 min'));
    expect(alertMessage('on', back, 'af').body).toBe(af.push.on.body('16:15', '2 u 13 min'));
  });

  it('shows minutes only for a short outage and drops a zero remainder', () => {
    const short = { ...off, endTime: '2026-10-22T12:09:00Z' };
    const whole = { ...off, endTime: '2026-10-22T14:02:00Z' };

    expect(alertMessage('on', short, 'en').body).toBe(en.push.on.body('14:09', '7 min'));
    expect(alertMessage('on', whole, 'en').body).toBe(en.push.on.body('16:02', '2 h'));
  });

  it("speaks the subscriber's language", () => {
    const afrikaans = alertMessage('off', off, 'af');
    const english = alertMessage('off', off, 'en');

    expect(afrikaans.title).toBe(af.push.off.title);
    expect(afrikaans.lang).toBe('af');
    expect(afrikaans.url).toBe(`${site.url}/`);
    expect(english.title).toBe(en.push.off.title);
    expect(english.lang).toBe('en');
    expect(english.url).toBe(`${site.url}/en/`);
  });

  it('uses one tag', () => {
    for (const kind of ALERT_KINDS) expect(alertMessage(kind, back, 'en').tag).toBe('power');
  });
});

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const db = () => createDb(env.DB);

const alertColumns = async (id: number) =>
  env.DB.prepare('SELECT off_alert_at, on_alert_at FROM outages WHERE id = ?')
    .bind(id)
    .first<{ off_alert_at: string | null; on_alert_at: string | null }>();

/** Sets `off_alert_at` straight in D1, as if the off alert had been claimed earlier. */
async function markOffAlerted(id: number): Promise<void> {
  await env.DB.prepare('UPDATE outages SET off_alert_at = ? WHERE id = ?').bind(ago(MINUTE_MS), id).run();
}

/** A stub queue; `sendBatch` is a spy. */
function stubQueue() {
  const sendBatch = vi.fn(async (_messages: Iterable<MessageSendRequest<AlertPage>>) => {});
  return { queue: { sendBatch } as unknown as Queue<AlertPage>, sendBatch };
}

/** Inserts `count` subscriptions with one statement: D1 caps the bound parameters of a single one. */
async function seedSubscriptions(count: number): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})
     INSERT INTO push_subscriptions (endpoint, p256dh, auth, locale, created_at)
     SELECT 'https://push.example/' || i, 'p256dh', 'auth', 'en', '2026-10-22T12:00:00.000Z' FROM n`,
  ).run();
}

const sentBodies = (sendBatch: ReturnType<typeof stubQueue>['sendBatch']) =>
  sendBatch.mock.calls.map(([messages]) => [...messages].map((message) => message.body));

describe('claimAlerts', () => {
  it('claims off once the outage is ALERT_DELAY_MS old', async () => {
    const id = await insertOutage({ startTime: ago(ALERT_DELAY_MS - MINUTE_MS) });
    expect(await claimAlerts(db(), NOW)).toEqual([]);

    await env.DB.prepare('UPDATE outages SET start_time = ? WHERE id = ?').bind(ago(ALERT_DELAY_MS), id).run();

    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'off', outageId: id }]);
    expect((await alertColumns(id))?.off_alert_at).toBe(NOW.toISOString());
  });

  it('claims each alert once', async () => {
    await insertOutage({ startTime: ago(ALERT_DELAY_MS) });

    expect(await claimAlerts(db(), NOW)).toHaveLength(1);
    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims at most once across concurrent calls', async () => {
    await insertOutage({ startTime: ago(ALERT_DELAY_MS) });

    const claims = await Promise.all([claimAlerts(db(), NOW), claimAlerts(db(), NOW)]);

    expect(claims.flat()).toHaveLength(1);
  });

  it('never claims a false positive', async () => {
    await insertOutage({ startTime: ago(ALERT_DELAY_MS), isFalsePositive: 1 });
    await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS), endTime: ago(ALERT_DELAY_MS), isFalsePositive: 1 });

    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims back on only after off was sent', async () => {
    const sent = await insertOutage({ startTime: ago(20 * MINUTE_MS), endTime: ago(MINUTE_MS) });
    await markOffAlerted(sent);
    await insertOutage({ startTime: ago(3 * MINUTE_MS), endTime: ago(MINUTE_MS) });

    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'on', outageId: sent }]);
    expect((await alertColumns(sent))?.on_alert_at).toBe(NOW.toISOString());
    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims off and back on in one run, off first', async () => {
    const open = await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS) });
    const closed = await insertOutage({ startTime: ago(30 * MINUTE_MS), endTime: ago(MINUTE_MS) });
    await markOffAlerted(closed);

    const claims = await claimAlerts(db(), NOW);

    expect(claims.map((claim) => claim.kind)).toEqual(['off', 'on']);
    expect(claims.map((claim) => claim.outageId)).toEqual([open, closed]);
  });
});

describe('enqueueAlerts', () => {
  const claim = { kind: 'off', outageId: 7 } as const;

  it('enqueues pages of PUSH_PAGE_SIZE', async () => {
    await seedSubscriptions(2 * PUSH_PAGE_SIZE + 5);
    const { queue, sendBatch } = stubQueue();

    await enqueueAlerts(db(), queue, [claim], NOW);

    const [bodies] = sentBodies(sendBatch);
    expect(sendBatch).toHaveBeenCalledOnce();
    expect(bodies?.map((body) => body.ids.length)).toEqual([PUSH_PAGE_SIZE, PUSH_PAGE_SIZE, 5]);
    for (const body of bodies ?? []) {
      expect(body).toMatchObject({ kind: 'off', outageId: 7, attempt: 1, queuedAt: NOW.toISOString() });
    }
    expect(bodies?.flatMap((body) => body.ids)).toHaveLength(2 * PUSH_PAGE_SIZE + 5);
  });

  it('sends nothing without subscriptions or claims', async () => {
    const { queue, sendBatch } = stubQueue();

    await enqueueAlerts(db(), queue, [claim], NOW);
    await seedSubscriptions(1);
    await enqueueAlerts(db(), queue, [], NOW);

    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('splits sendBatch at 100 messages', async () => {
    await seedSubscriptions(4001);
    const { queue, sendBatch } = stubQueue();

    await enqueueAlerts(db(), queue, [claim], NOW);

    expect(sentBodies(sendBatch).map((bodies) => bodies.length)).toEqual([100, 1]);
  });
});

describe('the minute cron', () => {
  it('enqueues due alerts', async () => {
    await insertOutage({ startTime: ago(ALERT_DELAY_MS) });
    await seedSubscriptions(1);
    const { queue, sendBatch } = stubQueue();

    await runCron(MINUTE_CRON, NOW.getTime(), { ...env, PUSH_QUEUE: queue });

    expect(sendBatch).toHaveBeenCalledOnce();
  });
});
