import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ERROR } from '../shared/errors';
import { CSV_PATH, LOGIN_PATH, ROBOTS_PATH, SITEMAP_PATH, STATS_PATH, STATUS_PATH } from '../shared/paths';
import { call } from './helpers';

describe('security headers on Worker responses', () => {
  it.each([STATUS_PATH, STATS_PATH, '/api/nope', ROBOTS_PATH, SITEMAP_PATH])('%s', async (path) => {
    const res = await call(path);
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('answers an unexpected failure with a bare internal error and the same headers', async () => {
    const broken = {
      ...env,
      DB: {
        prepare: () => {
          throw new Error('D1 is down: secret detail');
        },
        batch: () => Promise.reject(new Error('D1 is down: secret detail')),
      },
    } as unknown as Env;
    const res = await call(STATUS_PATH, { env: broken });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: ERROR.internal });
    expect(body).not.toContain('secret detail');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it('opens CORS only on the public read endpoints', async () => {
    for (const path of [STATUS_PATH, STATS_PATH, CSV_PATH]) {
      expect((await call(path)).headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    const admin = await call(LOGIN_PATH, { method: 'POST', body: { password: 'x' } });
    expect(admin.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
