import { render } from 'solid-js/web';
import { App, type InitialData } from './App';
import { api } from './lib/api';
import './styles/theme.css';
import './styles/global.css';

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
