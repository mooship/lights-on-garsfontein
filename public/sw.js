// The site has no service worker. An offline one was live on 17 and 18 October 2026, and browsers
// that visited then still run it: it can answer with a cached status when the server cannot be
// reached. Browsers check this URL on every visit and install these new bytes, which delete every
// cache the old worker made and unregister it. With no fetch handler, every request goes to the
// network from the moment it installs. Pages it controlled reload once onto the network.
// Keep this file for as long as such a browser might come back.

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
