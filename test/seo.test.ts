import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { call, insertOutage, setHeartbeat } from './helpers';

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

  it('serves the one status-neutral social card, whatever the status', async () => {
    const fetch = vi.fn(async () => new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    const assetsEnv = { ...env, ASSETS: { fetch } as unknown as Fetcher };
    await insertOutage({});
    const res = await call('/og.png', { env: assetsEnv });
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('png');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await setHeartbeat(5);
    expect((await call('/og.png', { method: 'HEAD', env: assetsEnv })).status).toBe(200);
    const urls = fetch.mock.calls.map((args) => String((args as unknown[])[0]));
    expect(urls).toEqual(['https://garsfontein.example/og/card.png', 'https://garsfontein.example/og/card.png']);
  });

  it('leaves the feed out of the sitemap, which lists pages only', async () => {
    expect(await (await call('/sitemap.xml')).text()).not.toContain('feed.xml');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
