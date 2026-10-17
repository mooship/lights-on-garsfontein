import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_THRESHOLD_MS, HOUR_MS } from '../shared/api';
import {
  call,
  getStatus,
  insertOutage,
  insertStillOff,
  mockTurnstile,
  ORIGIN,
  setHeartbeat,
  uniqueIp,
} from './helpers';

const report = (ip?: string, body: unknown = { token: 'turnstile-token' }) =>
  call('/api/still-off', { method: 'POST', body, ip });

const rowCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM still_off_reports').first<{ n: number }>())?.n ?? 0;

describe('POST /api/still-off', () => {
  it('records a report while ON and returns the recent count', async () => {
    mockTurnstile(true, 'still_off');
    await insertStillOff({ clientHash: 'neighbour' });
    const res = await report();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ reports: 2 });
    const row = await env.DB.prepare(
      "SELECT client_hash FROM still_off_reports WHERE client_hash != 'neighbour'",
    ).first<{
      client_hash: string;
    }>();
    expect(row?.client_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never changes the status', async () => {
    mockTurnstile(true, 'still_off');
    await setHeartbeat(10);
    expect((await report()).status).toBe(201);
    expect(await getStatus()).toMatchObject({ status: 'ON', outage: null, stillOffReports: 1 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM outages').first<{ n: number }>())?.n).toBe(0);
  });

  it('takes one report per client per two hours', async () => {
    mockTurnstile(true, 'still_off');
    const ip = uniqueIp();
    expect((await report(ip)).status).toBe(201);
    const again = await report(ip);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_reported' });
    // The same /64 is the same household.
    expect((await report('2001:db8:1:2::a')).status).toBe(201);
    expect((await report('2001:db8:1:2:ffff::b')).status).toBe(409);
    expect(await rowCount()).toBe(2);
  });

  it('takes a new report from the same client after two hours', async () => {
    mockTurnstile(true, 'still_off');
    const ip = uniqueIp();
    expect((await report(ip)).status).toBe(201);
    const earlier = new Date(Date.now() - 2 * HOUR_MS - 60_000).toISOString();
    await env.DB.prepare('UPDATE still_off_reports SET created_at = ?').bind(earlier).run();
    const res = await report(ip);
    expect(res.status).toBe(201);
    // The older one is outside the hour it counts for.
    expect(await res.json()).toEqual({ reports: 1 });
  });

  it('is refused while an outage is open', async () => {
    mockTurnstile(true, 'still_off');
    await insertOutage({ source: 'manual' });
    const res = await report();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'outage_in_progress' });
    expect(await rowCount()).toBe(0);
  });

  it('is refused while the heartbeat is stale', async () => {
    mockTurnstile(true, 'still_off');
    await setHeartbeat(HEARTBEAT_THRESHOLD_MS / 1000 + 60);
    const res = await report();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'outage_in_progress' });
  });

  it('rejects a failed Turnstile challenge, or one solved for another action', async () => {
    mockTurnstile(false, 'still_off');
    expect((await report()).status).toBe(403);
    mockTurnstile(true, 'confirm');
    const res = await report();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'turnstile_failed' });
    expect(await rowCount()).toBe(0);
  });

  it('validates the body', async () => {
    mockTurnstile(true, 'still_off');
    expect((await report(undefined, {})).status).toBe(400);
  });

  it('purges the cached status', async () => {
    mockTurnstile(true, 'still_off');
    expect((await getStatus()).stillOffReports).toBe(0);
    expect((await report()).status).toBe(201);
    expect((await getStatus()).stillOffReports).toBe(1);
  });

  it('rejects cross-site requests', async () => {
    mockTurnstile(true, 'still_off');
    const res = await call('/api/still-off', {
      method: 'POST',
      body: { token: 'x' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    const same = await call('/api/still-off', { method: 'POST', body: { token: 'x' }, headers: { Origin: ORIGIN } });
    expect(same.status).toBe(201);
    expect(same.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('rate limits at 5 requests per minute per IP', async () => {
    mockTurnstile(true, 'still_off');
    const ip = uniqueIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await report(ip)).status);
    expect(codes).toEqual([201, 409, 409, 409, 409, 429]);
  });
});
