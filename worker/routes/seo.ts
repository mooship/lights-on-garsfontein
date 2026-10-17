import { getPowerStatus } from '../lib/grid';
import type { RouteContext, Routes } from '../lib/router';

const SITEMAP_PATHS = ['/', '/privacy.html'];

function sitemap({ env }: RouteContext): Response {
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

function robots({ env }: RouteContext): Response {
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
async function ogImage({ request, env, db }: RouteContext): Promise<Response> {
  const status = await getPowerStatus(db, new Date());
  const asset = await env.ASSETS.fetch(new URL(`/og/${status.toLowerCase()}.png`, request.url));
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(asset.body, { status: asset.status, headers });
}

const pages: Routes = {
  '/sitemap.xml': { handler: sitemap },
  '/robots.txt': { handler: robots },
  '/og.png': { handler: ogImage, limiter: 'STATUS_LIMITER' },
};

/** Each page answers both GET and HEAD. */
export const seoRoutes: Routes = Object.fromEntries(
  Object.entries(pages).flatMap(([path, route]) => [
    [`GET ${path}`, route],
    [`HEAD ${path}`, route],
  ]),
);
