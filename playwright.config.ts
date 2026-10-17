import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;
// A throwaway local D1 so every run starts empty.
const STATE = '.wrangler/e2e-state';
// The placeholder from .dev.vars.example (--var beats .dev.vars), so a real address set there is never used.
const CONTACT_EMAIL = /^CONTACT_EMAIL="([^"\s]+)"/m.exec(readFileSync('.dev.vars.example', 'utf8'))?.[1];
if (!CONTACT_EMAIL) throw new Error('.dev.vars.example has no CONTACT_EMAIL');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // page.route does not see requests a service worker makes, so tests that stub the API would
    // pass or fail by whether the worker had taken control yet. The offline tests opt back in.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: [
      `node -e "require('node:fs').rmSync('${STATE}',{recursive:true,force:true})"`,
      'npm run build',
      `npx wrangler d1 migrations apply DB --local --env e2e --persist-to ${STATE}`,
      // --env e2e: rate limits for a test suite rather than for readers (wrangler.toml).
      `npx wrangler dev --env e2e --port ${PORT} --persist-to ${STATE} --var CONTACT_EMAIL:${CONTACT_EMAIL}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/api/status`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
