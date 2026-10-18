import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_ACTION } from '../shared/api';
import { ERROR } from '../shared/errors';
import { CONTACT_PATH } from '../shared/paths';
import { call, mockSiteverify, mockTurnstile, ORIGIN, uniqueIp } from './helpers';

// checkTurnstile (worker/lib/turnstile.ts), through /api/contact with CONTACT_EMAIL set, so a
// passing check answers 200 and a failing one 403.
const reveal = (options: { ip?: string; env?: Env } = {}) =>
  call(CONTACT_PATH, {
    method: 'POST',
    body: { token: 'turnstile-token' },
    ...options,
    env: { ...(options.env ?? env), CONTACT_EMAIL: 'contact@example.invalid' } as Env,
  });

const HOSTNAME = new URL(ORIGIN).hostname;

describe('Turnstile check', () => {
  it('sends the secret, the token and the client IP to siteverify', async () => {
    const spy = mockTurnstile(true, TURNSTILE_ACTION.contact);
    const ip = uniqueIp();
    expect((await reveal({ ip })).status).toBe(200);
    const [, init] = spy.mock.calls[0] ?? [];
    const form = init?.body as FormData;
    expect(form.get('secret')).toBe('test-secret');
    expect(form.get('response')).toBe('turnstile-token');
    expect(form.get('remoteip')).toBe(ip);
  });

  it('rejects a token solved for another action or host', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.login);
    expect((await reveal()).status).toBe(403);
    mockTurnstile(true, TURNSTILE_ACTION.contact, 'evil.example');
    expect((await reveal()).status).toBe(403);
  });

  it('rejects a passing answer that does not say which action and host it was solved for', async () => {
    for (const answer of [
      { success: true, hostname: HOSTNAME },
      { success: true, action: TURNSTILE_ACTION.contact },
    ]) {
      mockSiteverify(() => Response.json(answer));
      expect((await reveal()).status, JSON.stringify(answer)).toBe(403);
    }
  });

  it('treats a malformed siteverify answer as a failure', async () => {
    mockSiteverify(() => Response.json({ success: 'yes', action: TURNSTILE_ACTION.contact, hostname: HOSTNAME }));
    expect((await reveal()).status).toBe(403);
  });

  it('treats a siteverify error as a failure, even if its body says success', async () => {
    mockSiteverify(() =>
      Response.json({ success: true, action: TURNSTILE_ACTION.contact, hostname: HOSTNAME }, { status: 500 }),
    );
    expect((await reveal()).status).toBe(403);
  });

  it('answers 403, not 500, when siteverify cannot be reached', async () => {
    mockSiteverify(() => {
      throw new TypeError('Network connection lost.');
    });
    const res = await reveal();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ERROR.turnstileFailed });
  });

  it('accepts Cloudflare test secrets on localhost without action/host checks, but not their failures', async () => {
    const local = {
      ...env,
      SITE_URL: 'http://localhost:8787',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    } as Env;
    mockTurnstile(true, TURNSTILE_ACTION.login, 'example.com');
    expect((await reveal({ env: local })).status).toBe(200);
    mockTurnstile(false);
    expect((await reveal({ env: local })).status).toBe(403);
  });

  it('refuses Cloudflare test secrets outside localhost without calling siteverify', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = mockTurnstile(true, TURNSTILE_ACTION.contact);
    const deployed = { ...env, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' } as Env;
    expect((await reveal({ env: deployed })).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
