import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  call,
  insertOutage,
  mockTurnstile,
  ORIGIN,
  openOutageCount,
  runCron,
  sameWindow,
  setHeartbeat,
  uniqueIp,
} from './helpers';

const confirm = (ip?: string, body: unknown = { token: 'turnstile-token' }) =>
  call('/api/confirm', { method: 'POST', body, ip });

describe('POST /api/confirm', () => {
  it('rejects a failed Turnstile challenge', async () => {
    mockTurnstile(false);
    await insertOutage({});
    expect((await confirm()).status).toBe(403);
  });

  it('validates the body', async () => {
    mockTurnstile(true);
    expect((await confirm(undefined, {})).status).toBe(400);
  });

  it('returns 409 when the power is on', async () => {
    mockTurnstile(true);
    await setHeartbeat(5);
    const res = await confirm();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_active_outage' });
  });

  it('counts one confirmation per IP per outage', async () => {
    mockTurnstile(true);
    const outageId = await insertOutage({});
    const ip = uniqueIp();

    const first = await confirm(ip);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ confirmations: 1 });

    const again = await confirm(ip);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_confirmed' });

    const neighbour = await confirm();
    expect(await neighbour.json()).toEqual({ confirmations: 2 });

    const row = await env.DB.prepare('SELECT client_hash FROM outage_confirmations WHERE outage_id = ? LIMIT 1')
      .bind(outageId)
      .first<{ client_hash: string }>();
    expect(row?.client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.client_hash).not.toContain(ip);
  });

  it('opens a sensor outage on demand when the heartbeat is stale', async () => {
    mockTurnstile(true);
    await setHeartbeat(600);
    expect((await confirm()).status).toBe(201);
    const outage = await env.DB.prepare('SELECT source FROM outages').first<{ source: string }>();
    expect(outage?.source).toBe('sensor');
  });

  it('rate limits at 5 requests per minute per IP', async () => {
    mockTurnstile(true);
    await insertOutage({});
    const ip = uniqueIp();
    const codes: number[] = [];
    await sameWindow();
    for (let i = 0; i < 6; i++) codes.push((await confirm(ip)).status);
    expect(codes).toEqual([201, 409, 409, 409, 409, 429]);
  });

  it('counts addresses in the same IPv6 /64 as one neighbour', async () => {
    mockTurnstile(true);
    await insertOutage({});
    expect((await confirm('2001:db8:1:2::a')).status).toBe(201);
    const again = await confirm('2001:db8:1:2:ffff::b');
    expect(await again.json()).toEqual({ error: 'already_confirmed' });
  });

  it('refuses a confirmation meant for an outage that is no longer open', async () => {
    mockTurnstile(true);
    const ended = await insertOutage({ endTime: new Date().toISOString() });
    const current = await insertOutage({});
    const stale = await confirm(undefined, { token: 'x', outageId: ended });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'outage_changed' });
    expect((await confirm(undefined, { token: 'x', outageId: current })).status).toBe(201);
  });

  it('opens one outage when the cron and a confirmation race on a stale heartbeat', async () => {
    mockTurnstile(true);
    await setHeartbeat(600);
    const [res] = await Promise.all([confirm(), runCron(), confirm()]);
    expect(res.status).toBe(201);
    expect(await openOutageCount()).toBe(1);
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM outages').first<{ n: number }>()) ?? {};
    expect(n).toBe(1);
  });

  it('refuses requests the browser marks as cross-site', async () => {
    mockTurnstile(true);
    await insertOutage({});
    const res = await call('/api/confirm', {
      method: 'POST',
      body: { token: 'x' },
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects cross-site requests', async () => {
    mockTurnstile(true);
    const res = await call('/api/confirm', {
      method: 'POST',
      body: { token: 'x' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    const same = await call('/api/confirm', { method: 'POST', body: { token: 'x' }, headers: { Origin: ORIGIN } });
    expect(same.status).toBe(409);
  });
});
