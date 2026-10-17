// Emergency replacement for dist/sw.js, for when the offline service worker misbehaves in
// production. See "Offline support" in the README for how to deploy it.
//
// Browsers check /sw.js on every navigation, find these new bytes and install this worker. It
// takes over at once, deletes every cache the site made and unregisters itself; it has no fetch
// handler, so from then on every request goes to the network. A page that was open when it took
// over is back to normal at its next reload. It does not reload pages itself: src/index.tsx
// registers /sw.js again on every load, and a reload here would loop.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.registration.unregister();
    })(),
  );
});
