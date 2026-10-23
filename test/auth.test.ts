import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DAY_MS, TIMER_ACTION, TURNSTILE_ACTION } from '../shared/api';
import { ERROR } from '../shared/errors';
import { ADMIN_OUTAGES_PATH, LOGIN_PATH, LOGOUT_PATH, TIMER_PATH } from '../shared/paths';
import { SESSION_COOKIE } from '../worker/lib/cookies';
import { sha256Hex } from '../worker/lib/crypto';
import { ADMIN_USER_ID, SESSION_TTL_MS } from '../worker/routes/auth';
import {
  ADMIN_PASSWORD,
  asAdmin,
  call,
  createSession,
  login,
  loginAttempt,
  mockTurnstile,
  stubLimiter,
} from './helpers';

const sessionCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>())?.count;

describe('admin auth', () => {
  it('refuses all logins while no password hash is configured', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.login);
    const res = await loginAttempt(ADMIN_PASSWORD, { env: { ...env, ADMIN_PASSWORD_HASH: '' } as Env });
    expect(res.status).toBe(401);
  });

  it('requires a passing Turnstile check before checking the password', async () => {
    mockTurnstile(false, TURNSTILE_ACTION.login);
    const res = await loginAttempt(ADMIN_PASSWORD);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ERROR.turnstileFailed });
    const noToken = await call(LOGIN_PATH, { method: 'POST', body: { password: ADMIN_PASSWORD } });
    expect(noToken.status).toBe(400);
  });

  it('rejects a wrong username with the same answer as a wrong password', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.login);
    const res = await call(LOGIN_PATH, {
      method: 'POST',
      body: { username: 'someone', password: ADMIN_PASSWORD, token: 'turnstile-token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: ERROR.unauthorized });
  });

  it('accepts the username in any case', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.login);
    const res = await call(LOGIN_PATH, {
      method: 'POST',
      body: { username: ` ${env.ADMIN_USERNAME.toUpperCase()} `, password: ADMIN_PASSWORD, token: 'turnstile-token' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.login);
    const res = await loginAttempt('wrong');
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('sets a hardened session cookie and stores only its hash', async () => {
    mockTurnstile(true, TURNSTILE_ACTION.login);
    const res = await loginAttempt(ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[\\w-]{43};`));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(flag);

    const token = cookie.split(';')[0]?.split('=')[1] ?? '';
    const row = await env.DB.prepare('SELECT id, user_id FROM sessions').first<{ id: string; user_id: string }>();
    expect(row?.id).toBe(await sha256Hex(token));
    expect(row?.user_id).toBe(ADMIN_USER_ID);
  });

  it('protects admin endpoints', async () => {
    expect((await call(ADMIN_OUTAGES_PATH)).status).toBe(401);
    // Well-formed, under the real cookie name, but no such session.
    const forged = `${SESSION_COOKIE}=${'a'.repeat(43)}`;
    expect((await call(ADMIN_OUTAGES_PATH, { cookie: forged })).status).toBe(401);
    const res = await call(TIMER_PATH, { method: 'POST', body: { action: TIMER_ACTION.punchOut } });
    expect(res.status).toBe(401);
  });

  it('signs in with a cookie that opens the admin API', async () => {
    const cookie = await login();
    expect((await call(ADMIN_OUTAGES_PATH, { cookie })).status).toBe(200);
  });

  it('keeps you signed in for 30 days and renews the session on use', async () => {
    const fresh = await call(ADMIN_OUTAGES_PATH, { cookie: await createSession() });
    expect(fresh.headers.get('Set-Cookie')).toBeNull(); // brand-new session: nothing to renew

    const cookie = await createSession({ expiresAt: Date.now() + 3 * DAY_MS });
    const renewed = await call(ADMIN_OUTAGES_PATH, { cookie });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get('Set-Cookie')).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE id = ?')
      .bind(await sha256Hex(cookie.split('=')[1] ?? ''))
      .first<{ expires_at: string }>();
    expect(Date.parse(row?.expires_at ?? '') - Date.now()).toBeGreaterThan(29 * DAY_MS);
  });

  it('ends a session 90 days after sign-in, however recently it was used', async () => {
    const cookie = await createSession({ createdAt: Date.now() - 91 * DAY_MS, expiresAt: Date.now() + 29 * DAY_MS });
    expect((await call(ADMIN_OUTAGES_PATH, { cookie })).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });

  it('never renews a session past 90 days after sign-in', async () => {
    const createdAt = Date.now() - 80 * DAY_MS;
    const cookie = await createSession({ createdAt, expiresAt: Date.now() + 3 * DAY_MS });
    const renewed = await call(ADMIN_OUTAGES_PATH, { cookie });
    expect(renewed.status).toBe(200);
    const maxAge = Number(/Max-Age=(\d+)/.exec(renewed.headers.get('Set-Cookie') ?? '')?.[1]);
    expect(maxAge).toBeLessThanOrEqual(10 * 86_400);
    expect(maxAge).toBeGreaterThan(10 * 86_400 - 60);
    const row = await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: string }>();
    expect(row?.expires_at).toBe(new Date(createdAt + 90 * DAY_MS).toISOString());
    // Already at the limit: nothing left to renew.
    expect((await call(ADMIN_OUTAGES_PATH, { cookie })).headers.get('Set-Cookie')).toBeNull();
  });

  it('signs every session out when the password changes', async () => {
    const cookie = await createSession();
    const rotated = { ...env, ADMIN_PASSWORD_HASH: 'pbkdf2_sha256$100000$c2FsdA==$aGFzaA==' } as Env;
    expect((await call(ADMIN_OUTAGES_PATH, { cookie, env: rotated })).status).toBe(401);
    expect(await sessionCount()).toBe(0);
    expect((await call(ADMIN_OUTAGES_PATH, { cookie })).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const cookie = await createSession({ expiresAt: Date.now() - 1000 });
    expect((await call(ADMIN_OUTAGES_PATH, { cookie })).status).toBe(401);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const cookie = await createSession();
    const res = await call(LOGOUT_PATH, { method: 'POST', cookie });
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await call(ADMIN_OUTAGES_PATH, { cookie })).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });

  it('rate limits sign-in per connection, grouping IPv6 by /64, before checking Turnstile', async () => {
    const siteverify = mockTurnstile(true, TURNSTILE_ACTION.login);
    const limiter = stubLimiter();
    const res = await loginAttempt(ADMIN_PASSWORD, {
      ip: '2001:db8:abcd:12:1:2:3:4',
      env: { ...env, LOGIN_LIMITER: limiter },
    });
    expect(res.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: '2001:db8:abcd:12::/64' });
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('caps sign-in site-wide, counting only attempts that pass Turnstile', async () => {
    const cap = stubLimiter();
    const capped = { ...env, LOGIN_GLOBAL_LIMITER: cap };
    mockTurnstile(false, TURNSTILE_ACTION.login);
    expect((await loginAttempt(ADMIN_PASSWORD, { env: capped })).status).toBe(403);
    expect(cap.limit).not.toHaveBeenCalled();
    mockTurnstile(true, TURNSTILE_ACTION.login);
    // Even the right password is refused once the cap is reached.
    expect((await loginAttempt(ADMIN_PASSWORD, { env: capped })).status).toBe(429);
    expect(cap.limit).toHaveBeenCalledOnce();
  });

  it('accepts the admin API token so agents can log outages', async () => {
    expect((await asAdmin(TIMER_PATH, { action: TIMER_ACTION.punchOut })).status).toBe(201);
    const headers = { Authorization: `Bearer ${env.ADMIN_API_TOKEN}` };
    expect((await call(ADMIN_OUTAGES_PATH, { headers })).status).toBe(200);
    // Checked before the sign-in limit, so it neither counts towards it nor is refused by it.
    const limiter = stubLimiter();
    expect((await call(ADMIN_OUTAGES_PATH, { headers, env: { ...env, LOGIN_LIMITER: limiter } })).status).toBe(200);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it('rejects a wrong API token without falling back to cookies, and rate limits guesses', async () => {
    const cookie = await createSession();
    const headers = { Authorization: 'Bearer nope' };
    expect((await call(ADMIN_OUTAGES_PATH, { cookie, headers })).status).toBe(401);
    const limiter = stubLimiter();
    const limited = await call(ADMIN_OUTAGES_PATH, { cookie, headers, env: { ...env, LOGIN_LIMITER: limiter } });
    expect(limited.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledOnce();
  });

  it('refuses API tokens when none is configured', async () => {
    const res = await call(ADMIN_OUTAGES_PATH, {
      headers: { Authorization: 'Bearer ' },
      env: { ...env, ADMIN_API_TOKEN: '' } as Env,
    });
    expect(res.status).toBe(401);
  });
});
