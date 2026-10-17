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

beforeEach(async () => {
  await env.DB.batch(
    ['outage_confirmations', 'outages', 'heartbeats', 'sessions'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
