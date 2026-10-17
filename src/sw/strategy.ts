// Shared by the service worker (sw.ts) and the app, which reads FROM_CACHE_HEADER. No DOM or
// worker globals, so test/sw.test.ts can run it.

import { STATUS_PATH } from '../../shared/paths';

export { STATUS_PATH };

/**
 * - page: network first, then this build's copy.
 * - asset: cache first; hashed file names never change content.
 * - status: network first, then the last status, marked with FROM_CACHE_HEADER.
 * - network: not handled at all, so the browser fetches it as if there were no worker.
 */
export type Strategy = 'page' | 'asset' | 'status' | 'network';

/** On a status the worker served from its cache because the network failed: not current. */
export const FROM_CACHE_HEADER = 'X-From-Cache';

/** One cache per build, so the worker that activates can delete the others. */
export const cacheName = (buildId: string) => `shell-${buildId}`;

/** The last status, outside the build caches, so a deploy does not take it away. */
export const STATUS_CACHE = 'status';

/** Another build's shell, for the worker of build `current` to delete. */
export const isOldShell = (name: string, current: string) => name.startsWith(cacheName('')) && name !== current;

/**
 * The /assets/ URLs `html` references that are not in this build. Any means the page is another
 * deploy's, fetched while this one installed, and would not work offline.
 */
export const strayAssets = (html: string, assets: readonly string[]) =>
  (html.match(/\/assets\/[^"'\s)]+/g) ?? []).filter((url) => !assets.includes(url));

/**
 * An allowlist: `pages` (the worker's precached HTML), the hashed assets and the status. Everything
 * else goes to the network untouched, including every write, /admin, the admin and report APIs,
 * the CSV, feed and social card, /cdn-cgi/ and other origins (Turnstile).
 */
export function strategyFor(method: string, url: URL, origin: string, pages: readonly string[]): Strategy {
  if (method !== 'GET' || url.origin !== origin) return 'network';
  if (pages.includes(url.pathname)) return 'page';
  if (url.pathname.startsWith('/assets/')) return 'asset';
  if (url.pathname === STATUS_PATH) return 'status';
  return 'network';
}
