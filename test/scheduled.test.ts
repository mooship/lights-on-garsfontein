import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../shared/api';
import { HOURLY_CRON } from '../worker/crons';
import { createSession, getStatus, insertOutage, openOutageCount, runCron, setHeartbeat } from './helpers';

const EXPIRED = { createdAt: Date.parse('2000-01-01T00:00:00Z'), expiresAt: Date.parse('2000-01-02T00:00:00Z') };

const sessionExpiries = async () =>
  (await env.DB.prepare('SELECT expires_at FROM sessions').all<{ expires_at: string }>()).results.map(
    (r) => r.expires_at,
  );

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
    const expiresAt = Date.now() + DAY_MS;
    await createSession(EXPIRED);
    await createSession({ expiresAt });
    await runCron(HOURLY_CRON);
    expect(await sessionExpiries()).toEqual([new Date(expiresAt).toISOString()]);
  });

  it('does not run on the per-minute cron', async () => {
    await createSession(EXPIRED);
    await runCron();
    expect(await sessionExpiries()).toHaveLength(1);
  });
});
