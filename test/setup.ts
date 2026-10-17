import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-plugin';
import { afterEach, beforeEach, vi } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/** Routes with `edgeCache`; the Cache API outlives a test, so empty it like the tables. */
const EDGE_CACHED = ['/api/status', '/api/stats', '/api/outages.csv', '/feed.xml'];

const TABLES = ['outage_confirmations', 'outages', 'heartbeats', 'sessions', 'still_off_reports'];

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
