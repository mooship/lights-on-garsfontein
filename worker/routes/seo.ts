import { localePath } from '../../shared/locale';
import { site } from '../../site.config';
import type { RouteContext, Routes } from '../lib/router';

function sitemap({ env }: RouteContext): Response {
  // Each language page lists all of them, so a search engine can show the reader's language.
  const alternates = [...site.locales.map((locale) => [locale, localePath(locale)]), ['x-default', '/']]
    .map(
      ([hreflang, path]) => `\n    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${env.SITE_URL}${path}"/>`,
    )
    .join('');
  const languagePages = site.locales.map(
    (locale) =>
      `  <url><loc>${env.SITE_URL}${localePath(locale)}</loc><changefreq>always</changefreq>${alternates}</url>`,
  );
  const urls = [...languagePages, `  <url><loc>${env.SITE_URL}/privacy</loc><changefreq>yearly</changefreq></url>`];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
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

Sitemap: ${env.SITE_URL}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

/**
 * The social card. Status-neutral on purpose: a shared link's preview outlives the moment, so it
 * never claims ON or OFF. A Worker route so the public URL stays stable whatever the asset is.
 */
async function ogImage({ request, env }: RouteContext): Promise<Response> {
  const asset = await env.ASSETS.fetch(new URL('/og/card.png', request.url));
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(asset.body, { status: asset.status, headers });
}

const pages: Routes = {
  '/sitemap.xml': { handler: sitemap },
  '/robots.txt': { handler: robots },
  // A static asset with no D1 work behind it, so it needs no limiter or edge cache.
  '/og.png': { handler: ogImage },
};

export const seoRoutes: Routes = Object.fromEntries(
  Object.entries(pages).flatMap(([path, route]) => [
    [`GET ${path}`, route],
    [`HEAD ${path}`, route],
  ]),
);
