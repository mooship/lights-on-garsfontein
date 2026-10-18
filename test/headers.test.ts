import { describe, expect, it } from 'vitest';
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

  it('opens CORS only on the public read endpoints', async () => {
    for (const path of [STATUS_PATH, STATS_PATH, CSV_PATH]) {
      expect((await call(path)).headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    const admin = await call(LOGIN_PATH, { method: 'POST', body: { password: 'x' } });
    expect(admin.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
