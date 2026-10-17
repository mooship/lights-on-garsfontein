import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { call, insertOutage, mockSiteverify, mockTurnstile, ORIGIN, uniqueIp } from './helpers';

// checkTurnstile (worker/lib/turnstile.ts), through /api/confirm with an outage open, so a
// passing check answers 201 and a failing one 403.
const confirm = (options: { ip?: string; env?: Env } = {}) =>
  call('/api/confirm', { method: 'POST', body: { token: 'turnstile-token' }, ...options });

const HOSTNAME = new URL(ORIGIN).hostname;

describe('Turnstile check', () => {
  it('sends the secret, the token and the client IP to siteverify', async () => {
    const spy = mockTurnstile(true);
    await insertOutage({});
    const ip = uniqueIp();
    expect((await confirm({ ip })).status).toBe(201);
    const [, init] = spy.mock.calls[0] ?? [];
    const form = init?.body as FormData;
    expect(form.get('secret')).toBe('test-secret');
    expect(form.get('response')).toBe('turnstile-token');
    expect(form.get('remoteip')).toBe(ip);
  });

  it('rejects a token solved for another action', async () => {
    await insertOutage({});
    mockTurnstile(true, 'login');
    expect((await confirm()).status).toBe(403);
  });

  it('rejects a passing answer that does not say which action and host it was solved for', async () => {
    await insertOutage({});
    for (const answer of [
      { success: true, hostname: HOSTNAME },
      { success: true, action: 'confirm' },
    ]) {
      mockSiteverify(() => Response.json(answer));
      expect((await confirm()).status, JSON.stringify(answer)).toBe(403);
    }
  });

  it('treats a malformed siteverify answer as a failure', async () => {
    await insertOutage({});
    mockSiteverify(() => Response.json({ success: 'yes', action: 'confirm', hostname: HOSTNAME }));
    expect((await confirm()).status).toBe(403);
  });

  it('treats a siteverify error as a failure, even if its body says success', async () => {
    await insertOutage({});
    mockSiteverify(() => Response.json({ success: true, action: 'confirm', hostname: HOSTNAME }, { status: 500 }));
    expect((await confirm()).status).toBe(403);
  });

  it('answers 403, not 500, when siteverify cannot be reached', async () => {
    await insertOutage({});
    mockSiteverify(() => {
      throw new TypeError('Network connection lost.');
    });
    const res = await confirm();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'turnstile_failed' });
  });

  it('accepts Cloudflare test secrets on localhost without action/host checks, but not their failures', async () => {
    await insertOutage({});
    const local = {
      ...env,
      SITE_URL: 'http://localhost:8787',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    } as Env;
    mockTurnstile(true, 'login', 'example.com');
    expect((await confirm({ env: local })).status).toBe(201);
    mockTurnstile(false);
    expect((await confirm({ env: local })).status).toBe(403);
  });

  it('refuses Cloudflare test secrets outside localhost without calling siteverify', async () => {
    await insertOutage({});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = mockTurnstile(true);
    const deployed = { ...env, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' } as Env;
    expect((await confirm({ env: deployed })).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
