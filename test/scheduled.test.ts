import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../shared/api';
import {
  getStatus,
  HOURLY_CRON,
  insertConfirmation,
  insertOutage,
  insertStillOff,
  openOutageCount,
  runCron,
  setHeartbeat,
} from './helpers';

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

  it('does not reopen an outage dismissed as a false positive while the sensor stays silent', async () => {
    await setHeartbeat(240);
    await runCron();
    expect(await openOutageCount()).toBe(1);
    // The admin marks the dead sensor's outage as a false positive.
    await env.DB.prepare('UPDATE outages SET is_false_positive = 1, end_time = ?').bind(new Date().toISOString()).run();
    await runCron();
    expect(await openOutageCount()).toBe(0);
    expect((await getStatus()).status).toBe('ON');
  });

  it('leaves outage detection to the per-minute cron', async () => {
    await setHeartbeat(240);
    await runCron(HOURLY_CRON);
    expect(await outages()).toHaveLength(0);
  });
});

describe('housekeeping (hourly cron)', () => {
  it('purges expired sessions', async () => {
    await env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at, password_fingerprint) VALUES (?, ?, ?, '', ''), (?, ?, ?, '', '')",
    )
      .bind('old', 'admin', '2000-01-01T00:00:00.000Z', 'new', 'admin', '2999-01-01T00:00:00.000Z')
      .run();
    await runCron(HOURLY_CRON);
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(['new']);
  });

  it('does not run on the per-minute cron', async () => {
    await env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at, password_fingerprint) VALUES (?, ?, ?, '', '')",
    )
      .bind('old', 'admin', '2000-01-01T00:00:00.000Z')
      .run();
    await runCron();
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
  });

  it('replaces confirmation fingerprints after 30 days', async () => {
    const id = await insertOutage({});
    await insertConfirmation(id, { createdAt: new Date(Date.now() - 31 * DAY_MS).toISOString(), clientHash: 'aaa' });
    await insertConfirmation(id, { clientHash: 'bbb' });
    await runCron(HOURLY_CRON);
    const rows = await env.DB.prepare('SELECT client_hash FROM outage_confirmations ORDER BY id').all<{
      client_hash: string;
    }>();
    expect(rows.results.map((r) => r.client_hash)).toEqual([expect.stringMatching(/^purged:\d+$/), 'bbb']);
  });

  it('replaces "still off" fingerprints after 30 days and deletes reports after 90', async () => {
    const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
    await insertStillOff({ createdAt: ago(91), clientHash: 'old' });
    await insertStillOff({ createdAt: ago(31), clientHash: 'aaa' });
    await insertStillOff({ clientHash: 'bbb' });
    await runCron(HOURLY_CRON);
    const rows = await env.DB.prepare('SELECT client_hash FROM still_off_reports ORDER BY id').all<{
      client_hash: string;
    }>();
    expect(rows.results.map((r) => r.client_hash)).toEqual([expect.stringMatching(/^purged:\d+$/), 'bbb']);
  });
});
