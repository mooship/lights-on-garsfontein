import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { LOCALES, localePath } from '../../shared/locale';
import { ADMIN_PAGE_PATH, PRIVACY_PAGE_PATH } from '../../shared/paths';
import { site } from '../../site.config';

type Listener = (event: unknown) => void;

const SOURCE = readFileSync(resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');

/** Runs public/sw.js against fakes of the worker globals it uses, and returns them with its listeners. */
function loadWorker(options: { caches?: string[]; clients?: { url?: string; focus: () => Promise<unknown> }[] } = {}) {
  const listeners = new Map<string, Listener>();
  const cacheNames = new Set(options.caches ?? []);
  const self = {
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => {}), unregister: vi.fn(async () => true) },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => options.clients ?? []),
      openWindow: vi.fn(async () => null),
    },
  };
  const caches = {
    keys: async () => [...cacheNames],
    delete: vi.fn(async (name: string) => cacheNames.delete(name)),
  };
  vm.runInNewContext(SOURCE, { self, caches, URL });

  /** Dispatches an event and returns what the worker passed to waitUntil. */
  const dispatch = async (name: string, event: Record<string, unknown> = {}) => {
    const pending: Promise<unknown>[] = [];
    listeners.get(name)?.({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  return { self, caches, cacheNames, listeners, dispatch };
}

// The shape of AlertPayload (worker/lib/alerts.ts); importing it would pull Worker types into the node project.
const payload = {
  title: 'Power is off',
  body: 'Since 18:04',
  tag: 'power',
  url: 'https://example.test/en/',
  lang: 'en',
} as const;

describe('the service worker', () => {
  it('handles only install, activate, push and notificationclick', () => {
    // No fetch listener: with one, a stale status could be served as live.
    expect([...loadWorker().listeners.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
  });

  it('activates at once and takes over open pages', async () => {
    const { self, dispatch } = loadWorker();
    await dispatch('install');
    await dispatch('activate');
    expect(self.skipWaiting).toHaveBeenCalled();
    expect(self.clients.claim).toHaveBeenCalled();
  });

  it('deletes every cache on activate, and neither unregisters nor reloads pages', async () => {
    const page = { focus: vi.fn(), navigate: vi.fn() };
    const { self, caches, cacheNames, dispatch } = loadWorker({ caches: ['old-shell', 'old-data'], clients: [page] });
    await dispatch('activate');
    expect(caches.delete).toHaveBeenCalledWith('old-shell');
    expect(caches.delete).toHaveBeenCalledWith('old-data');
    expect(cacheNames.size).toBe(0);
    expect(self.registration.unregister).not.toHaveBeenCalled();
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it('shows the pushed notification', async () => {
    const { self, dispatch } = loadWorker();
    await dispatch('push', { data: { json: () => payload } });
    expect(self.registration.showNotification).toHaveBeenCalledWith(payload.title, {
      body: payload.body,
      tag: 'power',
      lang: payload.lang,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url },
    });
  });

  it.each([
    ['has no data', null],
    [
      'has data that is not JSON',
      {
        json: () => {
          throw new SyntaxError('Unexpected token');
        },
      },
    ],
    ['has JSON null', { json: () => null }],
    ['has an object without a string title', { json: () => ({ ...payload, title: 7 }) }],
  ])('shows a neutral notification when a push %s', async (_case, data) => {
    const { self, dispatch } = loadWorker();
    await expect(dispatch('push', { data })).resolves.toBeUndefined();
    expect(self.registration.showNotification).toHaveBeenCalledWith(site.brand.full, {
      body: undefined,
      tag: 'power',
      lang: undefined,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: '/' },
    });
  });

  const ORIGIN = 'https://example.test';
  const windowAt = (path: string, focus = vi.fn(async () => {})) => ({ url: `${ORIGIN}${path}`, focus });
  const clickEvent = () => ({ notification: { close: vi.fn(), data: { url: payload.url } } });

  it.each(LOCALES)('focuses an open status page in %s rather than the admin or privacy page', async (locale) => {
    const admin = windowAt(ADMIN_PAGE_PATH);
    const privacy = windowAt(PRIVACY_PAGE_PATH);
    const status = windowAt(localePath(locale));
    const { self, dispatch } = loadWorker({ clients: [admin, privacy, status] });

    await dispatch('notificationclick', clickEvent());

    expect(status.focus).toHaveBeenCalled();
    expect(admin.focus).not.toHaveBeenCalled();
    expect(privacy.focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens the alert’s page when only the admin or privacy page is open', async () => {
    const admin = windowAt(ADMIN_PAGE_PATH);
    const privacy = windowAt(`${PRIVACY_PAGE_PATH}#en`);
    const { self, dispatch } = loadWorker({ clients: [admin, privacy] });

    await dispatch('notificationclick', clickEvent());

    expect(admin.focus).not.toHaveBeenCalled();
    expect(privacy.focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith(payload.url);
  });

  it('opens the alert’s page when focusing the open one fails', async () => {
    const status = windowAt(
      '/',
      vi.fn(() => Promise.reject(new Error('not allowed'))),
    );
    const { self, dispatch } = loadWorker({ clients: [status] });

    await dispatch('notificationclick', clickEvent());

    expect(self.clients.openWindow).toHaveBeenCalledWith(payload.url);
  });

  it('focuses an open page or opens the alert’s page on click', async () => {
    const close = vi.fn();
    const event = { notification: { close, data: { url: payload.url } } };

    const page = windowAt('/en/');
    const open = loadWorker({ clients: [page] });
    await open.dispatch('notificationclick', event);
    expect(close).toHaveBeenCalledTimes(1);
    expect(page.focus).toHaveBeenCalled();
    expect(open.self.clients.openWindow).not.toHaveBeenCalled();

    const none = loadWorker();
    await none.dispatch('notificationclick', event);
    expect(close).toHaveBeenCalledTimes(2);
    expect(none.self.clients.openWindow).toHaveBeenCalledWith(payload.url);
  });
});
