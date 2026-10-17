import { createScheduledController, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../shared/api';
import worker from '../worker/index';
import { insertConfirmation, insertOutage, setHeartbeat } from './helpers';

const runCron = (scheduledTime = Date.now()) =>
  worker.scheduled(createScheduledController({ scheduledTime, cron: '* * * * *' }), env);

/** Housekeeping runs at minute 0; use the current hour's start so cutoffs stay relative to now. */
const topOfHour = () => Math.floor(Date.now() / HOUR_MS) * HOUR_MS;

const outages = async () =>
  (
    await env.DB.prepare('SELECT start_time, end_time, source FROM outages').all<{
      start_time: string;
      source: string;
    }>()
  ).results;

describe('scheduled outage detection', () => {
  it('opens a sensor outage starting at the last heartbeat once it goes stale', async () => {
    const lastSeen = await setHeartbeat(240);
    await runCron();
    expect(await outages()).toEqual([{ start_time: lastSeen, end_time: null, source: 'sensor' }]);
  });

  it('is idempotent', async () => {
    await setHeartbeat(240);
    await runCron();
    await runCron();
    expect(await outages()).toHaveLength(1);
  });

  it('does nothing while heartbeats are fresh or never arrived', async () => {
    await runCron();
    await setHeartbeat(30);
    await runCron();
    expect(await outages()).toHaveLength(0);
  });

  it('does not open a second outage when one is already open', async () => {
    await setHeartbeat(240);
    await insertOutage({ source: 'manual' });
    await runCron();
    expect(await outages()).toHaveLength(1);
  });

  it('purges expired sessions', async () => {
    await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?), (?, ?, ?)')
      .bind('old', 'admin', '2000-01-01T00:00:00.000Z', 'new', 'admin', '2999-01-01T00:00:00.000Z')
      .run();
    await runCron(topOfHour());
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(['new']);
  });
});

describe('housekeeping schedule', () => {
  it('skips the purges outside minute 0', async () => {
    await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
      .bind('old', 'admin', '2000-01-01T00:00:00.000Z')
      .run();
    await runCron(topOfHour() + 5 * 60_000);
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
  });
});

describe('confirmation fingerprints', () => {
  it('are replaced after 30 days while the count stays', async () => {
    const id = await insertOutage({});
    await insertConfirmation(id, { createdAt: new Date(Date.now() - 31 * DAY_MS).toISOString(), clientHash: 'aaa' });
    await insertConfirmation(id, { clientHash: 'bbb' });
    await runCron(topOfHour());
    const rows = await env.DB.prepare('SELECT client_hash FROM outage_confirmations ORDER BY id').all<{
      client_hash: string;
    }>();
    expect(rows.results.map((r) => r.client_hash)).toEqual([expect.stringMatching(/^purged:\d+$/), 'bbb']);
  });
});
