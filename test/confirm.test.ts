import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, insertOutage, mockTurnstile, ORIGIN, setHeartbeat, uniqueIp } from './helpers';

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

  it('sends the token and client IP to siteverify', async () => {
    const spy = mockTurnstile(true);
    await insertOutage({});
    const ip = uniqueIp();
    await confirm(ip);
    const [, init] = spy.mock.calls[0] ?? [];
    const form = init?.body as FormData;
    expect(form.get('secret')).toBe('test-secret');
    expect(form.get('response')).toBe('turnstile-token');
    expect(form.get('remoteip')).toBe(ip);
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
    for (let i = 0; i < 6; i++) codes.push((await confirm(ip)).status);
    expect(codes).toEqual([201, 409, 409, 409, 409, 429]);
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
