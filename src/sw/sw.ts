// The offline service worker, built into dist/sw.js by the serviceWorker plugin in vite.config.ts
// and registered by src/index.tsx; strategy.ts decides what it handles. If it misbehaves in
// production, deploy scripts/sw-kill-switch.js in its place (README, "Offline support").

import * as sw from './strategy';

declare const self: ServiceWorkerGlobalScope;
// Filled in at build time. The id hashes these files and src/sw/, so each deploy gets new worker
// bytes (which is what makes browsers install it) and a cache of its own.
declare const __BUILD_ID__: string;
declare const __PAGES__: string[];
declare const __ASSETS__: string[];

const SHELL = sw.cacheName(__BUILD_ID__);
const NETWORK_TIMEOUT_MS = 3000;

const install = async () => {
  const cache = await caches.open(SHELL);
  await cache.addAll([...__PAGES__.map((page) => new Request(page, { cache: 'no-cache' })), ...__ASSETS__]);
  // A page from a deploy that landed mid-install would need assets this cache lacks. Failing
  // leaves the old worker in charge, and the browser tries again at the next navigation.
  for (const page of __PAGES__) {
    const copy = await cache.match(page);
    if (!copy || copy.redirected || sw.strayAssets(await copy.text(), __ASSETS__).length) {
      await caches.delete(SHELL);
      throw new Error(`sw: ${page} is not this build's`);
    }
  }
  // Safe mid-session: pages are network first, and a page that then misses an old lazy chunk
  // reloads onto the new build (vite:preloadError in src/index.tsx).
  await self.skipWaiting();
};

const activate = async () => {
  for (const name of await caches.keys()) if (sw.isOldShell(name, SHELL)) await caches.delete(name);
  await self.registration.navigationPreload?.enable(); // the page request starts while the worker boots
  await self.clients.claim();
};

self.addEventListener('install', (event) => event.waitUntil(install()));
self.addEventListener('activate', (event) => event.waitUntil(activate()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const strategy = sw.strategyFor(event.request.method, url, self.location.origin, __PAGES__);
  // match with cacheName, never open(SHELL): opening would recreate a shell a newer worker deleted.
  const shell = (key: RequestInfo) => caches.match(key, { cacheName: SHELL });
  if (strategy === 'asset') event.respondWith(shell(event.request).then((hit) => hit ?? fetch(event.request)));
  else if (strategy === 'page') event.respondWith(page(event, () => shell(url.pathname)));
  else if (strategy === 'status') event.respondWith(status(event));
  // Anything else: no respondWith, so the browser fetches it as if there were no worker.
});

/** `network`, or undefined if it fails or takes longer than NETWORK_TIMEOUT_MS. */
const inTime = (network: Promise<Response>) =>
  Promise.race([network, new Promise<undefined>((r) => setTimeout(r, NETWORK_TIMEOUT_MS))]).catch(() => undefined);

/** Never stored at runtime, so offline a page is always this build's copy, matching its assets. */
async function page(event: FetchEvent, precached: () => Promise<Response | undefined>): Promise<Response> {
  const network: Promise<Response> = (async () => (await event.preloadResponse) ?? fetch(event.request))();
  network.catch(() => {}); // once the copy has answered, a later failure matters to no one
  return (await inTime(network)) ?? (await precached()) ?? network;
}

async function status(event: FetchEvent): Promise<Response> {
  const network = fetch(event.request).then(async (response) => {
    // A failed write (storage full) costs only the offline copy, not this reply.
    const copy = response.ok && response.clone();
    if (copy)
      await caches
        .open(sw.STATUS_CACHE)
        .then((c) => c.put(sw.STATUS_PATH, copy))
        .catch(() => {});
    return response;
  });
  // Registered now, while the event accepts it, so a reply that loses to the timeout is still kept.
  // A failure is answered below from the cache.
  event.waitUntil(network.catch(() => {}));
  const fresh = await inTime(network);
  if (fresh?.ok) return fresh;
  // Slow, failing or refusing (5xx, 429): the last good status, flagged as not current.
  const copy = await caches.match(sw.STATUS_PATH, { cacheName: sw.STATUS_CACHE });
  if (!copy) return fresh ?? network;
  const headers = new Headers(copy.headers);
  headers.set(sw.FROM_CACHE_HEADER, '1');
  return new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers });
}
