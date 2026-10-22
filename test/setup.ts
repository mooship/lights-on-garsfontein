import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-plugin';
import { afterEach, beforeEach, vi } from 'vitest';
import { EDGE_CACHED } from './helpers';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const TABLES = ['outages', 'heartbeats', 'sessions', 'push_subscriptions'];

// The Cache API outlives a test, so it is emptied like the tables.
beforeEach(async () => {
  await Promise.all([
    env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`))),
    ...EDGE_CACHED.map((path) => caches.default.delete(`${env.SITE_URL}${path}`)),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
