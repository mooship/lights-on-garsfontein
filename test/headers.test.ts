import { describe, expect, it } from 'vitest';
import { call } from './helpers';

describe('security headers on Worker responses', () => {
  it.each(['/api/status', '/api/stats', '/api/nope', '/robots.txt', '/sitemap.xml'])('%s', async (path) => {
    const res = await call(path);
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('opens CORS only on the public read endpoints', async () => {
    for (const path of ['/api/status', '/api/stats', '/api/outages.csv']) {
      expect((await call(path)).headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    const admin = await call('/api/admin/login', { method: 'POST', body: { password: 'x' } });
    expect(admin.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
