import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_THRESHOLD_MS, HOUR_MS, MINUTE_MS, TIMER_ACTION } from '../shared/api';
import { ERROR } from '../shared/errors';
import { HEARTBEAT_PATH, STATUS_PATH, TIMER_PATH } from '../shared/paths';
import { createDb } from '../worker/db/client';
import { getGridState } from '../worker/lib/grid';
import {
  asAdmin,
  call,
  heartbeat,
  insertOutage,
  runCron,
  setHeartbeat,
  getStatus as status,
  stubLimiter,
} from './helpers';

describe('GET /api/status', () => {
  it('is ON in manual mode before any sensor heartbeat arrives', async () => {
    const body = await status();
    expect(body).toMatchObject({ status: 'ON', since: null, turnstileSiteKey: 'test-site-key' });
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('lastSeen');
  });

  it('is not monitored before any heartbeat', async () => {
    expect(await status()).toMatchObject({ status: 'ON', monitored: false });
  });

  it('is monitored while the heartbeat is fresh', async () => {
    await setHeartbeat(30);
    expect(await status()).toMatchObject({ status: 'ON', monitored: true });
  });

  it('is not monitored once the heartbeat is stale, and OFF as before', async () => {
    await setHeartbeat(HEARTBEAT_THRESHOLD_MS / 1000 + 60);
    await runCron();
    expect(await status()).toMatchObject({ status: 'OFF', monitored: false, outage: expect.anything() });
  });

  it('is not monitored when a stale heartbeat was dismissed as a false positive', async () => {
    const lastSeen = await setHeartbeat(HEARTBEAT_THRESHOLD_MS / 1000 + 60);
    await insertOutage({ startTime: lastSeen, endTime: new Date().toISOString(), isFalsePositive: 1 });
    expect(await status()).toMatchObject({ status: 'ON', monitored: false });
  });

  it('is OFF in manual mode while the admin has an outage open', async () => {
    await insertOutage({ source: 'manual' });
    expect(await status()).toMatchObject({ status: 'OFF' });
  });

  it('never reveals how an outage was recorded', async () => {
    await insertOutage({ source: 'manual' });
    const body = await status();
    expect(body.outage).not.toHaveProperty('source');
    expect(body.recent[0]).not.toHaveProperty('source');
  });

  it(`is OFF once the heartbeat is more than ${HEARTBEAT_THRESHOLD_MS / 1000} seconds old, not at exactly that`, async () => {
    const lastSeen = await setHeartbeat(0);
    const at = (ms: number) => getGridState(createDb(env.DB), new Date(Date.parse(lastSeen) + ms));
    expect(await at(HEARTBEAT_THRESHOLD_MS)).toMatchObject({ status: 'ON', monitored: true });
    expect(await at(HEARTBEAT_THRESHOLD_MS + 1)).toMatchObject({ status: 'OFF', since: lastSeen, monitored: false });
  });

  it('is OFF while an outage is open, even with a fresh heartbeat', async () => {
    await setHeartbeat(10);
    const startTime = new Date(Date.now() - MINUTE_MS).toISOString();
    const id = await insertOutage({ startTime, source: 'manual' });
    const body = await status();
    expect(body.status).toBe('OFF');
    expect(body.since).toBe(startTime);
    expect(body.outage?.id).toBe(id);
  });

  it('gives each outage its times and whether it was planned, and nothing else', async () => {
    const startTime = new Date(Date.now() - 10 * MINUTE_MS).toISOString();
    const id = await insertOutage({ startTime, isPlanned: 1 });
    const body = await status();
    const summary = { id, startTime, endTime: null, planned: true };
    expect(body.outage).toEqual(summary);
    expect(body.recent).toEqual([summary]);
    expect(Object.keys(body).sort()).toEqual(
      ['generatedAt', 'monitored', 'outage', 'recent', 'since', 'status', 'turnstileSiteKey'].sort(),
    );
  });

  it('ignores false-positive outages', async () => {
    await setHeartbeat(10);
    await insertOutage({ isFalsePositive: 1 });
    const body = await status();
    expect(body.status).toBe('ON');
    expect(body.recent).toHaveLength(0);
  });

  it('reports ON since the end of the last outage', async () => {
    await setHeartbeat(10);
    const endTime = new Date(Date.now() - 2 * MINUTE_MS).toISOString();
    await insertOutage({ startTime: new Date(Date.now() - 15 * MINUTE_MS).toISOString(), endTime });
    const body = await status();
    expect(body.since).toBe(endTime);
    expect(body.recent[0]?.endTime).toBe(endTime);
  });

  it('reports ON since the latest end when outages overlap', async () => {
    await setHeartbeat(10);
    const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS).toISOString();
    const lastEnd = ago(5);
    // The newest outage by start ended first; the older one ran on past it.
    await insertOutage({ startTime: ago(60), endTime: lastEnd, source: 'manual' });
    await insertOutage({ startTime: ago(50), endTime: ago(30) });
    expect(await status()).toMatchObject({ status: 'ON', since: lastEnd });
  });

  it('answers HEAD with the JSON headers', async () => {
    const res = await call(STATUS_PATH, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('is never cached by browsers, from the edge cache or not', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await call(STATUS_PATH);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.has('X-Browser-Cache-Control')).toBe(false);
    }
  });

  it('is rate limited per connection by STATUS_LIMITER', async () => {
    const limiter = stubLimiter();
    const ip = '196.25.1.9';
    const res = await call(STATUS_PATH, { ip, env: { ...env, STATUS_LIMITER: limiter } });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: ERROR.rateLimited });
    expect(limiter.limit).toHaveBeenCalledWith({ key: ip });
  });
});

describe('GET /api/status edge cache', () => {
  it('serves a repeat request within the TTL from the edge cache', async () => {
    const first = await status();
    // Written straight to D1, so nothing purges the cached copy.
    await insertOutage({ source: 'manual' });
    expect(await status()).toEqual(first);
  });

  it('ignores the query string, so it cannot be used to skip the cache', async () => {
    const first = await status();
    await insertOutage({ source: 'manual' });
    expect(await (await call('/api/status?x=1')).json()).toEqual(first);
  });

  it('is not purged by a refused admin write', async () => {
    const first = await status();
    await insertOutage({ source: 'manual' });
    expect((await asAdmin(TIMER_PATH, { action: TIMER_ACTION.punchOut })).status).toBe(409);
    expect(await status()).toEqual(first);
  });
});

describe('POST /api/heartbeat', () => {
  it('rejects requests without the sensor token', async () => {
    expect((await call(HEARTBEAT_PATH, { method: 'POST' })).status).toBe(401);
    const wrong = await call(HEARTBEAT_PATH, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('rejects every heartbeat while no sensor token is configured', async () => {
    const noToken = { ...env, HEARTBEAT_TOKEN: '' } as Env;
    const res = await call(HEARTBEAT_PATH, {
      method: 'POST',
      headers: { Authorization: 'Bearer undefined' },
      env: noToken,
    });
    expect(res.status).toBe(401);
    const forged = await call(HEARTBEAT_PATH, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
      env: noToken,
    });
    expect(forged.status).toBe(401);
  });

  it('records the heartbeat', async () => {
    const res = await heartbeat();
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT last_seen FROM heartbeats WHERE id = 1').first<{ last_seen: string }>();
    expect(Date.now() - Date.parse(row?.last_seen ?? '')).toBeLessThan(5_000);
  });

  it('records an outage that began and ended between two cron runs', async () => {
    const lastSeen = await setHeartbeat(240);
    const res = await heartbeat();
    expect(await res.json()).toEqual({ ok: true, closedOutages: 0 });
    const rows = await env.DB.prepare('SELECT start_time, end_time, source FROM outages').all<{
      start_time: string;
      end_time: string | null;
      source: string;
    }>();
    expect(rows.results).toEqual([{ start_time: lastSeen, end_time: expect.any(String), source: 'sensor' }]);
  });

  it('records no extra outage after a fresh heartbeat, or when the silence is already on record', async () => {
    await setHeartbeat(30);
    await heartbeat();
    const lastSeen = await setHeartbeat(240);
    await insertOutage({ startTime: lastSeen, endTime: new Date().toISOString(), isFalsePositive: 1 });
    await heartbeat();
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM outages').first<{ n: number }>()) ?? {};
    expect(n).toBe(1);
  });

  it('closes every open outage, manual ones included', async () => {
    await insertOutage({ source: 'sensor' });
    await insertOutage({ source: 'manual' });
    const res = await heartbeat();
    expect(await res.json()).toEqual({ ok: true, closedOutages: 2 });
    const rows = await env.DB.prepare('SELECT end_time FROM outages').all<{ end_time: string | null }>();
    expect(rows.results.map((r) => r.end_time)).toEqual([expect.any(String), expect.any(String)]);
    expect(await status()).toMatchObject({ status: 'ON', monitored: true });
  });

  it('closes an open manual outage over a stale gap without recording the gap again', async () => {
    const lastSeen = await setHeartbeat(600);
    const manual = await insertOutage({
      startTime: new Date(Date.parse(lastSeen) + MINUTE_MS).toISOString(),
      source: 'manual',
    });
    await heartbeat();
    const rows = await env.DB.prepare('SELECT id, end_time FROM outages').all<{
      id: number;
      end_time: string | null;
    }>();
    expect(rows.results).toEqual([{ id: manual, end_time: expect.any(String) }]);
  });

  it('closes a manual outage that began before the last heartbeat, with no gap outage', async () => {
    const manual = await insertOutage({ startTime: new Date(Date.now() - HOUR_MS).toISOString(), source: 'manual' });
    await setHeartbeat(600);
    await heartbeat();
    const rows = await env.DB.prepare('SELECT id, end_time FROM outages').all<{
      id: number;
      end_time: string | null;
    }>();
    expect(rows.results).toEqual([{ id: manual, end_time: expect.any(String) }]);
  });
});
