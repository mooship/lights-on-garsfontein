import { createDb } from '../db/client';
import { getPowerStatus } from '../lib/grid';

const SITEMAP_PATHS = ['/', '/privacy.html'];

function sitemap(env: Env): Response {
  const urls = SITEMAP_PATHS.map(
    (path) =>
      `  <url><loc>${env.SITE_URL}${path}</loc><changefreq>${path === '/' ? 'always' : 'yearly'}</changefreq></url>`,
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

function robots(env: Env): Response {
  const body = `User-agent: *
Allow: /
Disallow: /api/admin/
Disallow: /admin

Sitemap: ${env.SITE_URL}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

/** Social card that reflects the live status: serves one of the pre-rendered PNGs. */
async function ogImage(request: Request, env: Env): Promise<Response> {
  const status = await getPowerStatus(createDb(env.DB), new Date());
  const asset = await env.ASSETS.fetch(new URL(`/og/${status.toLowerCase()}.png`, request.url));
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(asset.body, { status: asset.status, headers });
}

export async function handleSeoRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  switch (url.pathname) {
    case '/sitemap.xml':
      return sitemap(env);
    case '/robots.txt':
      return robots(env);
    case '/og.png':
      return ogImage(request, env);
    default:
      return null;
  }
}
