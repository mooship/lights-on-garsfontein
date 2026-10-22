// Shows power alerts pushed to this browser, and does nothing else.
//
// There is no fetch handler on purpose: every request goes to the network, so a stale status can never
// be served as live. Activation still deletes every cache, because browsers that visited on 17 or 18
// October 2026 run an earlier offline worker whose cached status this file replaces.

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
  const { title, body, tag, lang, url } = event.data.json();
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

// An open page is only focused, not navigated: it polls the status itself and the reader keeps their place.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const [page] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (page) await page.focus();
      else await self.clients.openWindow(event.notification.data.url);
    })(),
  );
});
