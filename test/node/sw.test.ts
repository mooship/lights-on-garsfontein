import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;

const SOURCE = readFileSync(resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');

/** Runs public/sw.js against fakes of the worker globals it uses, and returns them with its listeners. */
function loadWorker(options: { caches?: string[]; clients?: { focus: () => Promise<unknown> }[] } = {}) {
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
  vm.runInNewContext(SOURCE, { self, caches });

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

  it('focuses an open page or opens the alert’s page on click', async () => {
    const close = vi.fn();
    const event = { notification: { close, data: { url: payload.url } } };

    const page = { focus: vi.fn(async () => {}) };
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
