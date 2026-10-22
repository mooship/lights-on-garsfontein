// Shows power alerts pushed to this browser, and does nothing else.
//
// There is no fetch handler on purpose: every request goes to the network, so a stale status can never
// be served as live. Activation still deletes every cache, because browsers that visited on 17 or 18
// October 2026 run an earlier offline worker whose cached status this file replaces.

// Shown when a push has no readable payload: a push that shows nothing counts as a silent push, which
// browsers penalise. It claims nothing about the power.
const FALLBACK = { title: '%site.brand.full%', tag: 'power', url: '/' };

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

// The payload is AlertPayload in worker/lib/alerts.ts; `tag` makes a newer alert replace an older one.
self.addEventListener('push', (event) => {
  let alert;
  try {
    alert = event.data.json();
  } catch {
    // No data, or data that is not JSON: fall back to the neutral notification below.
  }
  if (typeof alert?.title !== 'string') alert = FALLBACK;
  const { title, body, tag, lang, url } = alert;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      lang,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    }),
  );
});

// The status pages, where localePath (shared/locale.ts) puts them. The admin and privacy pages do
// not show the status, so a click never lands on them.
const [, ...otherLocales] = '%site.locales%'.split(' ');
const STATUS_PAGES = new Set(['/', ...otherLocales.map((locale) => `/${locale}/`)]);

// An open status page is only focused, not navigated: it polls the status itself and the reader keeps
// their place. Focusing can be refused, so the alert's page is then opened instead.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url } = event.notification.data;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const page = windows.find((client) => STATUS_PAGES.has(new URL(client.url).pathname));
      try {
        if (page) return await page.focus();
      } catch {
        // A refused focus falls through to opening the alert's page.
      }
      await self.clients.openWindow(url);
    })(),
  );
});
