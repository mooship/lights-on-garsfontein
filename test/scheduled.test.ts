import { createScheduledController, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { insertOutage, setHeartbeat } from './helpers';

const runCron = () =>
  worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '* * * * *' }), env);

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
    await runCron();
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(['new']);
  });
});

describe('confirmation fingerprints', () => {
  it('are replaced after 30 days while the count stays', async () => {
    const id = await insertOutage({});
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await env.DB.prepare(
      'INSERT INTO outage_confirmations (outage_id, created_at, client_hash) VALUES (?, ?, ?), (?, ?, ?)',
    )
      .bind(id, old, 'aaa', id, new Date().toISOString(), 'bbb')
      .run();
    await runCron();
    const rows = await env.DB.prepare('SELECT client_hash FROM outage_confirmations ORDER BY id').all<{
      client_hash: string;
    }>();
    expect(rows.results.map((r) => r.client_hash)).toEqual([expect.stringMatching(/^purged:\d+$/), 'bbb']);
  });
});
