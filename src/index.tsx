import { render } from 'solid-js/web';
import { App, type InitialData } from './App';
import { api } from './lib/api';
import { leaving } from './lib/i18n';
import './styles/theme.css';
import './styles/global.css';

function start() {
  // The public page starts its data requests before rendering so they overlap with hydration.
  const isAdmin = location.pathname.replace(/\/$/, '') === '/admin';
  let initial: InitialData | undefined;
  if (!isAdmin) {
    initial = { status: api.status(), stats: api.stats() };
    initial.status.catch(() => {});
    initial.stats.catch(() => {});
  }

  const root = document.getElementById('root');
  if (root) {
    // The static skeleton in index.html matches the app's loading state box for box.
    root.replaceChildren();
    render(() => <App initial={initial} />, root);
  }
}

// On / with another language chosen, the boot script is already loading that language's page.
if (!leaving) start();

// A lazy chunk of an older build can be gone once a new deploy's worker has taken over (sw.ts):
// a reload brings the page onto the current build. At most one reload per 10 s, so a chunk that is
// truly missing cannot loop, while a later deploy in the same tab can still recover.
addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem('chunk-reload'));
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem('chunk-reload', String(Date.now()));
  } catch {
    return; // without storage we cannot tell a loop apart, so do not risk one
  }
  location.reload();
});

// Production only: the dev server has no /sw.js. After load, so the worker's precache never
// competes with the page's own requests. Without it the site still works, only not offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}), { once: true });
}
