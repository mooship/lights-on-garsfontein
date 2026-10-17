import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../worker/lib/crypto';
import { call, login, uniqueIp } from './helpers';

describe('admin auth', () => {
  it('refuses all logins while no password hash is configured', async () => {
    const res = await call('/api/admin/login', {
      method: 'POST',
      body: { password: 'test-password' },
      env: { ...env, ADMIN_PASSWORD_HASH: '' } as Env,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const res = await call('/api/admin/login', { method: 'POST', body: { password: 'wrong' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('sets a hardened session cookie and stores only its hash', async () => {
    const res = await call('/api/admin/login', { method: 'POST', body: { password: 'test-password' } });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^admin_session=[\w-]{43};/);
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
    const ip = uniqueIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await call('/api/admin/login', { method: 'POST', body: { password: 'nope' }, ip })).status);
    }
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
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
