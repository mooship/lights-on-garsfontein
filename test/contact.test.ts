import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { TURNSTILE_ACTION } from '../shared/api';
import { ERROR } from '../shared/errors';
import { CONTACT_PATH } from '../shared/paths';
import { call, mockTurnstile, ORIGIN, stubLimiter } from './helpers';

const EMAIL = 'contact@example.invalid';
const configured = { ...env, CONTACT_EMAIL: EMAIL } as Env;

const reveal = (options: { body?: unknown; env?: Env; headers?: Record<string, string> } = {}) =>
  call(CONTACT_PATH, { method: 'POST', body: { token: 'turnstile-token' }, env: configured, ...options });

describe('POST /api/contact', () => {
  it('reveals the contact email for a Turnstile token solved for contact', async () => {
    const siteverify = mockTurnstile(true, TURNSTILE_ACTION.contact);
    const res = await reveal();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: EMAIL });
    expect(siteverify).toHaveBeenCalledOnce();
  });

  it('is never cached', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.contact);
    expect((await reveal()).headers.get('Cache-Control')).toBe('no-store');
    mockTurnstile(false, TURNSTILE_ACTION.contact);
    expect((await reveal()).headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 404 not_configured while CONTACT_EMAIL is unset', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.contact);
    for (const unset of [
      { ...env, CONTACT_EMAIL: '' },
      { ...env, CONTACT_EMAIL: undefined },
    ]) {
      const res = await reveal({ env: unset as unknown as Env });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: ERROR.notConfigured });
    }
  });

  it('rejects a failed Turnstile challenge', async () => {
    mockTurnstile(false, TURNSTILE_ACTION.contact);
    const res = await reveal();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ERROR.turnstileFailed });
  });

  it('validates the body', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.contact);
    expect((await reveal({ body: {} })).status).toBe(400);
    expect((await call(CONTACT_PATH, { method: 'POST', rawBody: '{', env: configured })).status).toBe(400);
    const form = await call(CONTACT_PATH, {
      method: 'POST',
      rawBody: 'token=x',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      env: configured,
    });
    expect(form.status).toBe(415);
  });

  it('rejects cross-site requests and sends no CORS header', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.contact);
    const cross = await reveal({ headers: { Origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: ERROR.forbidden });
    expect((await reveal({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    const same = await reveal({ headers: { Origin: ORIGIN } });
    expect(same.status).toBe(200);
    expect(same.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('is rate limited per connection by CONTACT_LIMITER, before Turnstile', async () => {
    const siteverify = mockTurnstile(true, TURNSTILE_ACTION.contact);
    const limiter = stubLimiter();
    const res = await reveal({ env: { ...configured, CONTACT_LIMITER: limiter } });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: ERROR.rateLimited });
    expect(limiter.limit).toHaveBeenCalledOnce();
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('is POST only', async () => {
    expect((await call(CONTACT_PATH, { env: configured })).status).toBe(404);
  });
});
