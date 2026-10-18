import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, mockTurnstile, ORIGIN, sameWindow, uniqueIp } from './helpers';

const EMAIL = 'contact@example.invalid';
const configured = { ...env, CONTACT_EMAIL: EMAIL } as Env;

const reveal = (options: { ip?: string; body?: unknown; env?: Env; headers?: Record<string, string> } = {}) =>
  call('/api/contact', { method: 'POST', body: { token: 'turnstile-token' }, env: configured, ...options });

describe('POST /api/contact', () => {
  it('reveals the contact email for a Turnstile token solved for contact', async () => {
    const siteverify = mockTurnstile(true, 'contact');
    const res = await reveal();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: EMAIL });
    expect(siteverify).toHaveBeenCalledOnce();
  });

  it('is never cached', async () => {
    mockTurnstile(true, 'contact');
    expect((await reveal()).headers.get('Cache-Control')).toBe('no-store');
    mockTurnstile(false, 'contact');
    expect((await reveal()).headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 404 not_configured while CONTACT_EMAIL is unset', async () => {
    mockTurnstile(true, 'contact');
    for (const unset of [
      { ...env, CONTACT_EMAIL: '' },
      { ...env, CONTACT_EMAIL: undefined },
    ]) {
      const res = await reveal({ env: unset as unknown as Env });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_configured' });
    }
  });

  it('rejects a failed Turnstile challenge', async () => {
    mockTurnstile(false, 'contact');
    const res = await reveal();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'turnstile_failed' });
  });

  it('rejects a token solved for another action', async () => {
    for (const action of ['login'] as const) {
      mockTurnstile(true, action);
      const res = await reveal();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'turnstile_failed' });
    }
  });

  it('validates the body', async () => {
    mockTurnstile(true, 'contact');
    expect((await reveal({ body: {} })).status).toBe(400);
    expect((await call('/api/contact', { method: 'POST', rawBody: '{', env: configured })).status).toBe(400);
    const form = await call('/api/contact', {
      method: 'POST',
      rawBody: 'token=x',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      env: configured,
    });
    expect(form.status).toBe(415);
  });

  it('rejects cross-site requests and sends no CORS header', async () => {
    mockTurnstile(true, 'contact');
    const cross = await reveal({ headers: { Origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: 'forbidden' });
    expect((await reveal({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    const same = await reveal({ headers: { Origin: ORIGIN } });
    expect(same.status).toBe(200);
    expect(same.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('rate limits at 5 requests per minute per IP', async () => {
    mockTurnstile(true, 'contact');
    const ip = uniqueIp();
    const codes: number[] = [];
    await sameWindow();
    for (let i = 0; i < 6; i++) codes.push((await reveal({ ip })).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('is POST only', async () => {
    expect((await call('/api/contact', { env: configured })).status).toBe(404);
  });
});
