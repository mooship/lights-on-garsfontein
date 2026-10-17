import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../worker/lib/crypto';
import { call, login, mockTurnstile, uniqueIp } from './helpers';

const attempt = (password: string, extra: Parameters<typeof call>[1] = {}) =>
  call('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password, token: 'turnstile-token' },
    ...extra,
  });

describe('admin auth', () => {
  it('refuses all logins while no password hash is configured', async () => {
    mockTurnstile(true, 'login');
    const res = await attempt('test-password', { env: { ...env, ADMIN_PASSWORD_HASH: '' } as Env });
    expect(res.status).toBe(401);
  });

  it('requires a passing Turnstile check before checking the password', async () => {
    mockTurnstile(false, 'login');
    const res = await attempt('test-password');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'turnstile_failed' });
    const noToken = await call('/api/admin/login', { method: 'POST', body: { password: 'test-password' } });
    expect(noToken.status).toBe(400);
  });

  it('rejects a Turnstile token solved for another action or host', async () => {
    mockTurnstile(true, 'confirm');
    expect((await attempt('test-password')).status).toBe(403);
    mockTurnstile(true, 'login', 'evil.example');
    expect((await attempt('test-password')).status).toBe(403);
  });

  it('rejects a wrong username with the same answer as a wrong password', async () => {
    mockTurnstile(true, 'login');
    const res = await call('/api/admin/login', {
      method: 'POST',
      body: { username: 'someone', password: 'test-password', token: 'turnstile-token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('accepts the username in any case', async () => {
    mockTurnstile(true, 'login');
    const res = await call('/api/admin/login', {
      method: 'POST',
      body: { username: ' Admin ', password: 'test-password', token: 'turnstile-token' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    mockTurnstile(true, 'login');
    const res = await attempt('wrong');
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('sets a hardened session cookie and stores only its hash', async () => {
    mockTurnstile(true, 'login');
    const res = await attempt('test-password');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^__Host-admin_session=[\w-]{43};/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(flag);

    const token = cookie.split(';')[0]?.split('=')[1] ?? '';
    const row = await env.DB.prepare('SELECT id, user_id FROM sessions').first<{ id: string; user_id: string }>();
    expect(row?.id).toBe(await sha256Hex(token));
    expect(row?.user_id).toBe('admin');
  });

  it('protects admin endpoints', async () => {
    expect((await call('/api/admin/outages')).status).toBe(401);
    expect((await call('/api/admin/outages', { cookie: 'admin_session=forged' })).status).toBe(401);
    const res = await call('/api/admin/timer', { method: 'POST', body: { action: 'punch_out' } });
    expect(res.status).toBe(401);
  });

  it('accepts a valid session', async () => {
    const cookie = await login();
    expect((await call('/api/admin/outages', { cookie })).status).toBe(200);
  });

  it('keeps you signed in for 30 days and renews the session on use', async () => {
    const cookie = await login();
    const fresh = await call('/api/admin/outages', { cookie });
    expect(fresh.headers.get('Set-Cookie')).toBeNull(); // brand-new session: nothing to renew

    await env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(new Date(Date.now() + 3 * 86_400_000).toISOString())
      .run();
    const renewed = await call('/api/admin/outages', { cookie });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get('Set-Cookie')).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const row = await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: string }>();
    expect(Date.parse(row?.expires_at ?? '') - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });

  it('rejects expired sessions', async () => {
    const cookie = await login();
    await env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await call('/api/admin/outages', { cookie })).status).toBe(401);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const cookie = await login();
    const res = await call('/api/admin/logout', { method: 'POST', cookie });
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await call('/api/admin/outages', { cookie })).status).toBe(401);
    const { count } = (await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>()) ?? {};
    expect(count).toBe(0);
  });

  it('rate limits login attempts at 5 per minute per IP', async () => {
    mockTurnstile(true, 'login');
    const ip = uniqueIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await attempt('nope', { ip })).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('accepts the admin API token so agents can log outages', async () => {
    const headers = { Authorization: 'Bearer test-admin-api-token' };
    const out = await call('/api/admin/timer', { method: 'POST', body: { action: 'punch_out' }, headers });
    expect(out.status).toBe(201);
    expect((await call('/api/admin/outages', { headers })).status).toBe(200);
  });

  it('rejects a wrong API token without falling back to cookies, and rate limits guesses', async () => {
    const cookie = await login();
    const ip = uniqueIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call('/api/admin/outages', { cookie, ip, headers: { Authorization: 'Bearer nope' } });
      codes.push(res.status);
    }
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('refuses API tokens when none is configured', async () => {
    const res = await call('/api/admin/outages', {
      headers: { Authorization: 'Bearer ' },
      env: { ...env, ADMIN_API_TOKEN: '' } as Env,
    });
    expect(res.status).toBe(401);
  });

  it('rejects cross-site admin writes', async () => {
    const cookie = await login();
    const res = await call('/api/admin/timer', {
      method: 'POST',
      cookie,
      body: { action: 'punch_out' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
