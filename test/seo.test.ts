import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { call, setHeartbeat } from './helpers';

describe('SEO routes', () => {
  it('serves robots.txt that hides the admin API and points at the sitemap', async () => {
    const res = await call('/robots.txt');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Disallow: /api/admin/');
    // /admin stays crawlable so its noindex header (public/_headers) can be seen.
    expect(body).not.toMatch(/^Disallow: \/admin$/m);
    expect(body).toContain('Sitemap: https://garsfontein.example/sitemap.xml');
  });

  it('serves an XML sitemap with the home and privacy pages', async () => {
    const res = await call('/sitemap.xml');
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<loc>https://garsfontein.example/</loc>');
    expect(body).toContain('<loc>https://garsfontein.example/privacy</loc>');
    expect(body).not.toContain('privacy.html');
  });

  it('serves the social card that matches the live status', async () => {
    await setHeartbeat(5);
    const fetch = vi.fn(async () => new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    const res = await call('/og.png', { env: { ...env, ASSETS: { fetch } as unknown as Fetcher } });
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://garsfontein.example/og/on.png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('serves repeat social card requests from the edge cache, whatever the query string', async () => {
    await setHeartbeat(5);
    const fetch = vi.fn(async () => new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    const assetsEnv = { ...env, ASSETS: { fetch } as unknown as Fetcher };
    expect((await call('/og.png', { env: assetsEnv })).status).toBe(200);
    const again = await call('/og.png?v=2', { env: assetsEnv });
    expect(await again.text()).toBe('png');
    expect(again.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
