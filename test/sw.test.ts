import { describe, expect, it } from 'vitest';
import {
  ADMIN_OUTAGES_PATH,
  ADMIN_PAGE_PATH,
  CONTACT_PATH,
  CSV_PATH,
  FEED_PATH,
  OG_IMAGE_PATH,
  PRIVACY_PAGE_PATH,
  SITEMAP_PATH,
  STATS_PATH,
  STATUS_PATH,
} from '../shared/paths';
import { cacheName, isOldShell, STATUS_CACHE, strategyFor, strayAssets } from '../src/sw/strategy';

const ORIGIN = 'https://garsfontein.example';
const PAGES = ['/', '/en/', PRIVACY_PAGE_PATH];
const strategy = (path: string, method = 'GET', origin = ORIGIN) =>
  strategyFor(method, new URL(path, origin), ORIGIN, PAGES);

describe('service worker strategy', () => {
  it('serves the precached pages network-first, whatever the query string', () => {
    for (const path of [...PAGES, '/?utm_source=whatsapp', '/en/?x=1']) expect(strategy(path)).toBe('page');
  });

  it('serves hashed assets cache-first', () => {
    expect(strategy('/assets/index-AbC123.js')).toBe('asset');
    expect(strategy('/assets/plus-jakarta-sans-latin-wght-normal-XyZ.woff2')).toBe('asset');
  });

  it('serves the status network-first, with the last copy as the fallback', () => {
    expect(strategy(STATUS_PATH)).toBe('status');
  });

  it('never touches writes, the admin, other API routes or other origins', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      expect(strategy(STATUS_PATH, method)).toBe('network');
      expect(strategy('/', method)).toBe('network');
    }
    for (const path of [
      ADMIN_PAGE_PATH,
      '/admin/',
      ADMIN_OUTAGES_PATH,
      CONTACT_PATH,
      STATS_PATH,
      CSV_PATH,
      FEED_PATH,
      OG_IMAGE_PATH,
      SITEMAP_PATH,
      '/sw.js',
      '/cdn-cgi/rum',
      '/en', // redirects to /en/; the browser follows it without the worker
      '/en/anything',
      '/privacy.html',
    ]) {
      expect(strategy(path), path).toBe('network');
    }
    expect(strategy('/turnstile/v0/api.js', 'GET', 'https://challenges.cloudflare.com')).toBe('network');
    expect(strategy('/assets/x.js', 'GET', 'https://evil.example')).toBe('network');
  });

  it('names one cache per build, so an update can drop the old one', () => {
    expect(cacheName('abc')).not.toBe(cacheName('abd'));
    expect(cacheName('abc')).toContain('abc');
  });

  it('drops only older shells on activate, keeping the status copy across deploys', () => {
    const current = cacheName('new');
    expect(isOldShell(cacheName('old'), current)).toBe(true);
    expect(isOldShell(current, current)).toBe(false);
    expect(isOldShell(STATUS_CACHE, current)).toBe(false);
  });

  it('finds assets a precached page references but the build does not have', () => {
    const assets = ['/assets/index-a.js', '/assets/index-b.css'];
    const html =
      '<link rel="stylesheet" href="/assets/index-b.css"><script type="module" src="/assets/index-a.js"></script>';
    expect(strayAssets(html, assets)).toEqual([]);
    // A page of another deploy, fetched while this one installed.
    const mixed = `${html}<link rel="preload" href="/assets/font-z.woff2">`;
    expect(strayAssets(mixed, assets)).toEqual(['/assets/font-z.woff2']);
  });
});
