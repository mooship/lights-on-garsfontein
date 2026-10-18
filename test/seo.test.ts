import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { ERROR } from '../shared/errors';
import { OG_IMAGE_PATH, ROBOTS_PATH, SITEMAP_PATH } from '../shared/paths';
import { call, insertOutage, setHeartbeat } from './helpers';

describe('SEO routes', () => {
  it('serves robots.txt that hides the admin API and points at the sitemap', async () => {
    const res = await call(ROBOTS_PATH);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Disallow: /api/admin/');
    // /admin stays crawlable so its noindex header (public/_headers) can be seen.
    expect(body).not.toMatch(/^Disallow: \/admin$/m);
    expect(body).toContain('Sitemap: https://garsfontein.example/sitemap.xml');
  });

  it('serves an XML sitemap with each language page and the privacy page', async () => {
    const res = await call(SITEMAP_PATH);
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    const body = await res.text();
    const locs = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://garsfontein.example/',
      'https://garsfontein.example/en/',
      'https://garsfontein.example/privacy',
    ]);
    expect(body).not.toContain('privacy.html');
  });

  it('links each language page to the others with hreflang', async () => {
    const body = await (await call(SITEMAP_PATH)).text();
    const alternates = [
      '<xhtml:link rel="alternate" hreflang="af" href="https://garsfontein.example/"/>',
      '<xhtml:link rel="alternate" hreflang="en" href="https://garsfontein.example/en/"/>',
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://garsfontein.example/"/>',
    ];
    const entries = body.split('<url>').slice(1);
    for (const entry of entries.slice(0, 2)) for (const link of alternates) expect(entry).toContain(link);
    expect(entries[2]).not.toContain('hreflang');
    expect(body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it('serves the one status-neutral social card, whatever the status', async () => {
    const fetch = vi.fn(async () => new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    const assetsEnv = { ...env, ASSETS: { fetch } as unknown as Fetcher };
    await insertOutage({});
    const res = await call(OG_IMAGE_PATH, { env: assetsEnv });
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('png');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await setHeartbeat(5);
    expect((await call(OG_IMAGE_PATH, { method: 'HEAD', env: assetsEnv })).status).toBe(200);
    const urls = fetch.mock.calls.map((args) => String((args as unknown[])[0]));
    expect(urls).toEqual(['https://garsfontein.example/og/card.png', 'https://garsfontein.example/og/card.png']);
  });

  it('leaves the feed out of the sitemap, which lists pages only', async () => {
    expect(await (await call(SITEMAP_PATH)).text()).not.toContain('feed.xml');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: ERROR.notFound });
  });
});
