import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { MINUTE_MS } from '../shared/api';
import { site } from '../site.config';
import { DICTIONARIES } from '../src/i18n/index';
import { MINUTE_CRON } from '../worker/crons';
import { createDb } from '../worker/db/client';
import worker from '../worker/index';
import * as alerts from '../worker/lib/alerts';
import {
  ALERT_DELAY_MS,
  type AlertPage,
  alertMessage,
  claimAlerts,
  enqueueAlerts,
  PUSH_MAX_ATTEMPTS,
  PUSH_PAGE_SIZE,
} from '../worker/lib/alerts';
import { deliverAlertPage } from '../worker/lib/deliver';
import { PUSH_TTL_SECONDS } from '../worker/lib/webpush';
import { expireTimeouts, insertOutage, insertSubscription, mockPushService, PUSH_TEST_HOST, runCron } from './helpers';

const { af, en } = DICTIONARIES;

const off = { startTime: '2026-10-22T12:02:00Z', endTime: null, isPlanned: false };
const back = { ...off, endTime: '2026-10-22T14:15:00Z' };

describe('alertMessage', () => {
  it('says when the power went off, in local time', () => {
    const { body } = alertMessage('off', off, 'en');

    expect(body).toBe(en.push.off.body('14:02'));
    expect(body).toContain('14:02');
    // One literal smoke string per language.
    expect(body).toBe('No power at the measuring point in Garsfontein Ext. 16 since 14:02.');
    expect(alertMessage('off', off, 'af').body).toBe(
      'Geen krag by die meetpunt in Garsfontein Uitb. 16 sedert 14:02 nie.',
    );
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

  it('counts a long outage in hours, not days', () => {
    const long = { ...off, endTime: '2026-10-23T14:07:00Z' };

    expect(alertMessage('on', long, 'en').body).toBe(en.push.on.body('16:07', '26 h 5 min'));
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
    // One tag, so a newer alert replaces the one on screen.
    for (const kind of ['off', 'on', 'dismissed'] as const) expect(alertMessage(kind, back, 'en').tag).toBe('power');
  });

  it('words the correction as the status page does, so it claims no more than the page shows', () => {
    const afrikaans = alertMessage('dismissed', off, 'af');
    const english = alertMessage('dismissed', off, 'en');

    expect(english.title).toBe(en.status.NONE);
    expect(afrikaans.title).toBe(af.status.NONE);
    expect(english).toMatchObject({ title: en.push.dismissed.title, body: en.push.dismissed.body, lang: 'en' });
    expect(afrikaans).toMatchObject({ title: af.push.dismissed.title, body: af.push.dismissed.body, lang: 'af' });
    // One literal smoke string per language.
    expect(english.title).toBe('No outage reported');
    expect(afrikaans.title).toBe('Geen onderbreking aangemeld nie');
    expect(english.body).toBe('The earlier alert about Garsfontein Ext. 16 was not confirmed.');
    expect(afrikaans.body).toBe('Die vorige waarskuwing oor Garsfontein Uitb. 16 is nie bevestig nie.');
  });
});

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const db = () => createDb(env.DB);
/** An open outage that is clearly due for its off alert, not one sitting on the ALERT_DELAY_MS boundary. */
const DUE_MS = ALERT_DELAY_MS + MINUTE_MS;

const alertColumns = async (id: number) =>
  env.DB.prepare('SELECT off_alert_at, on_alert_at FROM outages WHERE id = ?')
    .bind(id)
    .first<{ off_alert_at: string | null; on_alert_at: string | null }>();

/** An `offAlertAt` for insertOutage, as if the off alert had been claimed a minute earlier. */
const OFF_ALERTED = ago(MINUTE_MS);

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
    // Literal minutes on purpose: this pins the delay the owner chose, so changing it fails here.
    const id = await insertOutage({ startTime: ago(9 * MINUTE_MS) });
    expect(await claimAlerts(db(), NOW)).toEqual([]);

    await env.DB.prepare('UPDATE outages SET start_time = ? WHERE id = ?')
      .bind(ago(10 * MINUTE_MS), id)
      .run();

    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'off', outageId: id }]);
    expect((await alertColumns(id))?.off_alert_at).toBe(NOW.toISOString());
  });

  it('claims each alert once', async () => {
    await insertOutage({ startTime: ago(DUE_MS) });

    expect(await claimAlerts(db(), NOW)).toHaveLength(1);
    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims at most once across concurrent calls', async () => {
    await insertOutage({ startTime: ago(DUE_MS) });

    const claims = await Promise.all([claimAlerts(db(), NOW), claimAlerts(db(), NOW)]);

    expect(claims.flat()).toHaveLength(1);
  });

  it('never claims a false positive', async () => {
    await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1 });
    await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS), endTime: ago(ALERT_DELAY_MS), isFalsePositive: 1 });

    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims back on only after off was sent', async () => {
    const sent = await insertOutage({
      startTime: ago(20 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      offAlertAt: OFF_ALERTED,
    });
    await insertOutage({ startTime: ago(3 * MINUTE_MS), endTime: ago(MINUTE_MS) });

    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'on', outageId: sent }]);
    expect((await alertColumns(sent))?.on_alert_at).toBe(NOW.toISOString());
    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims off and back on in one run, off first', async () => {
    const open = await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS) });
    const closed = await insertOutage({
      startTime: ago(30 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      offAlertAt: OFF_ALERTED,
    });

    const claims = await claimAlerts(db(), NOW);

    expect(claims.map((claim) => claim.kind)).toEqual(['off', 'on']);
    expect(claims.map((claim) => claim.outageId)).toEqual([open, closed]);
  });

  it('claims dismissed once for a false positive whose off alert was sent', async () => {
    const open = await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1, offAlertAt: OFF_ALERTED });
    const closed = await insertOutage({
      startTime: ago(30 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      isFalsePositive: 1,
      offAlertAt: OFF_ALERTED,
    });
    await insertOutage({ startTime: ago(30 * MINUTE_MS), endTime: ago(MINUTE_MS), isFalsePositive: 1 });

    expect(await claimAlerts(db(), NOW)).toEqual([
      { kind: 'dismissed', outageId: open },
      { kind: 'dismissed', outageId: closed },
    ]);
    expect((await alertColumns(closed))?.on_alert_at).toBe(NOW.toISOString());
    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('never claims dismissed for an outage that was not dismissed', async () => {
    await insertOutage({ startTime: ago(DUE_MS), offAlertAt: OFF_ALERTED });

    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('never claims both back on and dismissed for one outage', async () => {
    const id = await insertOutage({ startTime: ago(30 * MINUTE_MS), endTime: ago(MINUTE_MS), offAlertAt: OFF_ALERTED });
    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'on', outageId: id }]);

    await env.DB.prepare('UPDATE outages SET is_false_positive = 1 WHERE id = ?').bind(id).run();

    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });

  it('claims off, then on, then dismissed in one run', async () => {
    const open = await insertOutage({ startTime: ago(2 * ALERT_DELAY_MS) });
    const dismissed = await insertOutage({
      startTime: ago(40 * MINUTE_MS),
      isFalsePositive: 1,
      offAlertAt: OFF_ALERTED,
    });
    const closed = await insertOutage({
      startTime: ago(30 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      offAlertAt: OFF_ALERTED,
    });

    const claims = await claimAlerts(db(), NOW);

    expect(claims).toEqual([
      { kind: 'off', outageId: open },
      { kind: 'on', outageId: closed },
      { kind: 'dismissed', outageId: dismissed },
    ]);
  });

  it('finds the outages awaiting a follow-up without scanning the table', async () => {
    // The follow-up claims' shared filter; the minute cron runs it, so a scan grows with the history.
    const { results } = await env.DB.prepare(
      'EXPLAIN QUERY PLAN UPDATE outages SET on_alert_at = ? WHERE off_alert_at IS NOT NULL AND on_alert_at IS NULL',
    )
      .bind(NOW.toISOString())
      .all<{ detail: string }>();

    expect(results.map(({ detail }) => detail)).not.toContainEqual(expect.stringMatching(/^SCAN outages/));
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

describe('a failed enqueue', () => {
  const failing = () => {
    const sendBatch = vi.fn(async (_messages: Iterable<MessageSendRequest<AlertPage>>) => {
      throw new Error('queue down');
    });
    return { sendBatch } as unknown as Queue<AlertPage>;
  };

  it.each([
    ['an off', { startTime: ago(DUE_MS) }, 'off'],
    ['an on', { startTime: ago(20 * MINUTE_MS), endTime: ago(MINUTE_MS), offAlertAt: OFF_ALERTED }, 'on'],
    ['a dismissed', { startTime: ago(DUE_MS), isFalsePositive: 1, offAlertAt: OFF_ALERTED }, 'dismissed'],
  ] as const)('releases %s claim, and only it, so the next run claims it again', async (_name, outage, kind) => {
    const id = await insertOutage(outage);
    await seedSubscriptions(3);
    const claims = await claimAlerts(db(), NOW);

    await expect(enqueueAlerts(db(), failing(), claims, NOW)).rejects.toThrow('queue down');

    const columns = await alertColumns(id);
    expect(kind === 'off' ? columns?.off_alert_at : columns?.on_alert_at).toBeNull();
    // A follow-up's release leaves the off claim alone.
    if (kind !== 'off') expect(columns?.off_alert_at).toBe(OFF_ALERTED);
    expect(await claimAlerts(db(), NOW)).toEqual([{ kind, outageId: id }]);
  });

  it('keeps a claim once some of its pages are queued', async () => {
    const id = await insertOutage({ startTime: ago(DUE_MS) });
    await seedSubscriptions(4001);
    const claims = await claimAlerts(db(), NOW);
    const sendBatch = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('queue down'));

    await expect(enqueueAlerts(db(), { sendBatch } as unknown as Queue<AlertPage>, claims, NOW)).rejects.toThrow(
      'queue down',
    );

    expect((await alertColumns(id))?.off_alert_at).toBe(NOW.toISOString());
    expect(await claimAlerts(db(), NOW)).toEqual([]);
  });
});

describe('the minute cron', () => {
  it('enqueues due alerts', async () => {
    await insertOutage({ startTime: ago(DUE_MS) });
    await seedSubscriptions(1);
    const { queue, sendBatch } = stubQueue();

    await runCron(MINUTE_CRON, NOW.getTime(), { ...env, PUSH_QUEUE: queue });

    expect(sendBatch).toHaveBeenCalledOnce();
  });
});

describe('deliverAlertPage', () => {
  const stubPushQueue = () => {
    const send = vi.fn(async (_body: AlertPage, _options?: QueueSendOptions) => {});
    return { send, env: { ...env, PUSH_QUEUE: { send } as unknown as Queue<AlertPage> } };
  };
  const pageFor = (outageId: number, ids: number[], overrides: Partial<AlertPage> = {}): AlertPage => ({
    kind: 'off',
    outageId,
    ids,
    attempt: 1,
    queuedAt: NOW.toISOString(),
    ...overrides,
  });
  const openOutage = () => insertOutage({ startTime: ago(DUE_MS) });
  const remainingIds = async () =>
    (await env.DB.prepare('SELECT id FROM push_subscriptions ORDER BY id').all<{ id: number }>()).results.map(
      ({ id }) => id,
    );

  it('sends one push per subscription on the page', async () => {
    const outage = await openOutage();
    const ids = [await insertSubscription('a'), await insertSubscription('b'), await insertSubscription('c')];
    const fetchSpy = mockPushService(() => 201);
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, ids), testEnv, NOW);

    const requests = fetchSpy.mock.calls.map(([request]) => request as Request);
    expect(requests.map((request) => request.url).sort()).toEqual(
      ['a', 'b', 'c'].map((name) => `https://${PUSH_TEST_HOST}/${name}`),
    );
    for (const request of requests) {
      expect(request.method).toBe('POST');
      expect(request.headers.get('Topic')).toBe('power');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('imports the VAPID key and signs once per push service, not once per subscription', async () => {
    const outage = await openOutage();
    const ids = [await insertSubscription('a'), await insertSubscription('b'), await insertSubscription('c')];
    const fetchSpy = mockPushService(() => 201);
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    const sign = vi.spyOn(crypto.subtle, 'sign');

    await deliverAlertPage(pageFor(outage, ids), stubPushQueue().env, NOW);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(importKey.mock.calls.filter(([format]) => format === 'jwk')).toHaveLength(1);
    expect(sign).toHaveBeenCalledOnce();
    const authorizations = fetchSpy.mock.calls.map(([request]) => (request as Request).headers.get('Authorization'));
    expect(new Set(authorizations).size).toBe(1);
  });

  it("writes each push in its subscriber's language", async () => {
    const outage = await openOutage();
    const ids = [await insertSubscription('af', 'af'), await insertSubscription('en', 'en')];
    mockPushService(() => 201);
    const spy = vi.spyOn(alerts, 'alertMessage');

    await deliverAlertPage(pageFor(outage, ids), stubPushQueue().env, NOW);

    expect(spy.mock.calls.map(([, , locale]) => locale).sort()).toEqual(['af', 'en']);
  });

  it('sends the back-on alert for a closed outage', async () => {
    const outage = await insertOutage({ startTime: ago(30 * MINUTE_MS), endTime: ago(MINUTE_MS) });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);

    await deliverAlertPage(pageFor(outage, [id], { kind: 'on' }), stubPushQueue().env, NOW);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('deletes subscriptions the push service says are gone', async () => {
    const outage = await openOutage();
    const gone = await insertSubscription('gone');
    const missing = await insertSubscription('missing');
    const fine = await insertSubscription('fine');
    mockPushService((endpoint) => (endpoint.endsWith('/gone') ? 410 : endpoint.endsWith('/missing') ? 404 : 201));
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [gone, missing, fine]), testEnv, NOW);

    expect(await remainingIds()).toEqual([fine]);
    expect(send).not.toHaveBeenCalled();
  });

  it('re-queues only transient failures', async () => {
    const outage = await openOutage();
    const ok = await insertSubscription('ok');
    const limited = await insertSubscription('limited');
    const down = await insertSubscription('down');
    mockPushService((endpoint) => (endpoint.endsWith('/limited') ? 429 : endpoint.endsWith('/down') ? 503 : 201));
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [ok, limited, down]), testEnv, NOW);

    expect(send).toHaveBeenCalledOnce();
    const [body, options] = send.mock.calls[0] ?? [];
    expect(body).toEqual(pageFor(outage, [limited, down], { attempt: 2 }));
    expect(options?.delaySeconds).toBeGreaterThan(0);
    expect(await remainingIds()).toEqual([ok, limited, down]);
  });

  it('treats a rejected fetch as transient', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('a');
    mockPushService(() => new Error('network down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [id]), testEnv, NOW);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].ids).toEqual([id]);
  });

  it('retries a push service that does not answer in time', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('a');
    mockPushService(() => 201);
    expireTimeouts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [id]), testEnv, NOW);

    expect(send).toHaveBeenCalledOnce();
  });
  it('logs a rejected send with the push host and the error name, but never the endpoint path', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('secret-path');
    // Some runtime errors quote the URL they failed on.
    mockPushService((endpoint) => new TypeError(`fetch failed for ${endpoint}`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await deliverAlertPage(pageFor(outage, [id]), stubPushQueue().env, NOW);

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain(PUSH_TEST_HOST);
    expect(logged).toContain('TypeError');
    // The message can quote the endpoint, so it is left out.
    expect(logged).not.toContain('fetch failed');
    expect(logged).not.toContain('secret-path');
  });

  it('drops the page and logs it when the VAPID key is unusable, never the key itself', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('secret-path');
    const fetchSpy = mockPushService(() => 201);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, env: testEnv } = stubPushQueue();
    const badKey = '{"kty":"EC","d":"not-a-key"}';

    await deliverAlertPage(pageFor(outage, [id]), { ...testEnv, VAPID_PRIVATE_KEY: badKey }, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('VAPID key');
    expect(logged).not.toContain('not-a-key');
    expect(logged).not.toContain('secret-path');
  });

  it('waits longer after each attempt and keeps queuedAt', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('a');
    mockPushService(() => 503);
    const { send, env: testEnv } = stubPushQueue();
    const queuedAt = ago(10 * MINUTE_MS);

    await deliverAlertPage(pageFor(outage, [id], { attempt: 1, queuedAt }), testEnv, NOW);
    await deliverAlertPage(pageFor(outage, [id], { attempt: 2, queuedAt }), testEnv, NOW);

    expect(send.mock.calls.map(([, options]) => options?.delaySeconds)).toEqual([60, 120]);
    expect(send.mock.calls.map(([body]) => body.queuedAt)).toEqual([queuedAt, queuedAt]);
  });

  it('gives up after PUSH_MAX_ATTEMPTS, and says so without naming an endpoint', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('secret-path');
    mockPushService(() => 503);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [id], { attempt: PUSH_MAX_ATTEMPTS }), testEnv, NOW);

    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain(PUSH_TEST_HOST);
    expect(logged).not.toContain('secret-path');
  });

  it('does not warn about giving up when every send succeeded or is gone', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('a');
    mockPushService(() => 410);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await deliverAlertPage(pageFor(outage, [id], { attempt: PUSH_MAX_ATTEMPTS }), stubPushQueue().env, NOW);

    expect(warn).not.toHaveBeenCalled();
  });

  it('logs other statuses with the push host but never the endpoint path', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('secret-path');
    mockPushService(() => 400);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [id]), testEnv, NOW);

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('400');
    expect(logged).toContain(PUSH_TEST_HOST);
    expect(logged).not.toContain('secret-path');
    expect(send).not.toHaveBeenCalled();
    expect(await remainingIds()).toEqual([id]);
  });

  it('drops a page older than the push TTL', async () => {
    const outage = await openOutage();
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);
    const queuedAt = ago((PUSH_TTL_SECONDS + 1) * 1000);

    await deliverAlertPage(pageFor(outage, [id], { queuedAt }), stubPushQueue().env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops an off alert for an outage dismissed meanwhile', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1 });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);

    await deliverAlertPage(pageFor(outage, [id]), stubPushQueue().env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops an off alert for an outage that has closed since', async () => {
    const outage = await insertOutage({ startTime: ago(10 * MINUTE_MS), endTime: ago(MINUTE_MS) });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);

    await deliverAlertPage(pageFor(outage, [id]), stubPushQueue().env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops an on alert for an outage that is not closed or was dismissed', async () => {
    const open = await openOutage();
    const dismissed = await insertOutage({
      startTime: ago(30 * MINUTE_MS),
      endTime: ago(MINUTE_MS),
      isFalsePositive: 1,
    });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);
    const { env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(open, [id], { kind: 'on' }), testEnv, NOW);
    await deliverAlertPage(pageFor(dismissed, [id], { kind: 'on' }), testEnv, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the dismissed alert while the outage is still a false positive, and drops it after', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1 });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);
    const { env: testEnv } = stubPushQueue();

    await deliverAlertPage(pageFor(outage, [id], { kind: 'dismissed' }), testEnv, NOW);
    expect(fetchSpy).toHaveBeenCalledOnce();

    await env.DB.prepare('UPDATE outages SET is_false_positive = 0 WHERE id = ?').bind(outage).run();
    await deliverAlertPage(pageFor(outage, [id], { kind: 'dismissed' }), testEnv, NOW);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('lets back on follow when a dismissal is undone and the outage later closes', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS), isFalsePositive: 1, offAlertAt: OFF_ALERTED });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);
    const [claim] = await claimAlerts(db(), NOW);
    expect(claim).toEqual({ kind: 'dismissed', outageId: outage });

    await env.DB.prepare('UPDATE outages SET is_false_positive = 0 WHERE id = ?').bind(outage).run();
    await deliverAlertPage(pageFor(outage, [id], { kind: 'dismissed' }), stubPushQueue().env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await alertColumns(outage))?.on_alert_at).toBeNull();

    await env.DB.prepare('UPDATE outages SET end_time = ? WHERE id = ?').bind(ago(MINUTE_MS), outage).run();
    expect(await claimAlerts(db(), NOW)).toEqual([{ kind: 'on', outageId: outage }]);
  });

  it('keeps a newer follow-up claim when a stale dismissed page is dropped', async () => {
    const outage = await insertOutage({
      startTime: ago(DUE_MS),
      endTime: ago(MINUTE_MS),
      offAlertAt: ago(2 * MINUTE_MS),
      onAlertAt: ago(MINUTE_MS),
    });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);

    await deliverAlertPage(pageFor(outage, [id], { kind: 'dismissed' }), stubPushQueue().env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await alertColumns(outage))?.on_alert_at).toBe(ago(MINUTE_MS));
  });

  it('drops a page whose outage no longer exists', async () => {
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);

    await deliverAlertPage(pageFor(9999, [id]), stubPushQueue().env, NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips ids that no longer exist', async () => {
    const outage = await openOutage();
    const kept = await insertSubscription('kept');
    const removed = await insertSubscription('removed');
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(removed).run();
    const fetchSpy = mockPushService(() => 201);

    await deliverAlertPage(pageFor(outage, [kept, removed]), stubPushQueue().env, NOW);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [request] = fetchSpy.mock.calls[0] ?? [];
    expect((request as Request).url).toBe(`https://${PUSH_TEST_HOST}/kept`);
  });
});

describe('the queue handler', () => {
  it('delivers each message, then acks it', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    const id = await insertSubscription('a');
    const fetchSpy = mockPushService(() => 201);
    const body: AlertPage = {
      kind: 'off',
      outageId: outage,
      ids: [id],
      attempt: 1,
      queuedAt: new Date().toISOString(),
    };
    const message = { body, ack: vi.fn() };

    await worker.queue({ messages: [message] } as unknown as MessageBatch<AlertPage>, env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it('never re-queues a page once its pushes went out, even if tidying up after them fails', async () => {
    const outage = await insertOutage({ startTime: ago(DUE_MS) });
    const gone = await insertSubscription('gone');
    const fine = await insertSubscription('fine');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn(async (_body: AlertPage, _options?: QueueSendOptions) => {});
    // D1 fails only the delete of the gone subscription.
    const DB = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'prepare') {
          return (query: string) => {
            if (/^delete/i.test(query)) throw new Error('D1 is down');
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const body: AlertPage = {
      kind: 'off',
      outageId: outage,
      ids: [gone, fine],
      attempt: 1,
      queuedAt: new Date().toISOString(),
    };
    const message = { body, ack: vi.fn() };
    const pushes = mockPushService((endpoint) => (endpoint.endsWith('/gone') ? 410 : 201));

    await worker.queue({ messages: [message] } as unknown as MessageBatch<AlertPage>, {
      ...env,
      DB,
      PUSH_QUEUE: { send } as unknown as Queue<AlertPage>,
    });

    expect(pushes).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('D1 is down');
  });

  // The queue never retries on its own (max_retries = 0), so a thrown job would be lost.
  it('re-queues a job that throws, up to PUSH_MAX_ATTEMPTS, logging only the error name', async () => {
    vi.spyOn(alerts, 'loadDueOutage').mockRejectedValue(new Error('D1 said something private'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn(async (_body: AlertPage, _options?: QueueSendOptions) => {});
    const queuedAt = new Date().toISOString();
    const page = (attempt: number): AlertPage => ({ kind: 'off', outageId: 1, ids: [1], attempt, queuedAt });
    const messages = [page(1), page(PUSH_MAX_ATTEMPTS)].map((body) => ({ body, ack: vi.fn() }));

    await worker.queue({ messages } as unknown as MessageBatch<AlertPage>, {
      ...env,
      PUSH_QUEUE: { send } as unknown as Queue<AlertPage>,
    });

    expect(send).toHaveBeenCalledOnce();
    const [body, options] = send.mock.calls[0] ?? [];
    expect(body).toEqual(page(2));
    expect(options?.delaySeconds).toBeGreaterThan(0);
    for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('Error');
    expect(logged).not.toContain('private');
  });
});
