// Kill switch. The site has no service worker, but browsers that visited on 17 or 18 October 2026
// still run an offline one that can answer with a cached status when the server is unreachable.
// They check this URL on every visit and install these bytes, which delete its caches, unregister
// it and reload the pages it controlled. With no fetch handler, every request goes to the network.
// Keep this file while such a browser might come back.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
