import { render } from 'solid-js/web';
import { ADMIN_PAGE_PATH } from '../shared/paths';
import { App, type InitialData } from './App';
import { api } from './lib/api';
import { leaving } from './lib/i18n';
import { countVisit } from './lib/push';
import { STORAGE_KEYS } from './lib/storage';
import './styles/theme.css';
import './styles/global.css';

function start() {
  // The public page starts its data requests before rendering so they overlap with hydration.
  const isAdmin = location.pathname.replace(/\/$/, '') === ADMIN_PAGE_PATH;
  let initial: InitialData | undefined;
  if (!isAdmin) {
    initial = { status: api.status(), stats: api.stats() };
    // createPoll reports failures; these only stop an unhandled rejection before it subscribes.
    initial.status.catch(() => {});
    initial.stats.catch(() => {});
    countVisit();
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

// A page left open across a deploy asks for lazy chunks of its own build, which the server no longer
// has: a reload brings the page onto the current build. At most one reload per CHUNK_RELOAD_GAP_MS, so a
// chunk that is truly missing cannot loop, while a later deploy in the same tab can still recover.
const CHUNK_RELOAD_GAP_MS = 10_000;
addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem(STORAGE_KEYS.chunkReload));
    if (Date.now() - last < CHUNK_RELOAD_GAP_MS) return;
    sessionStorage.setItem(STORAGE_KEYS.chunkReload, String(Date.now()));
  } catch {
    return; // without storage we cannot tell a loop apart, so do not risk one
  }
  location.reload();
});
