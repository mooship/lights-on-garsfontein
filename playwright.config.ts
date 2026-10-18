import { defineConfig, devices } from '@playwright/test';
import { STATUS_PATH } from './shared/paths';

const PORT = 8788;
// A throwaway local D1 so every run starts empty.
const STATE = '.wrangler/e2e-state';

export default defineConfig({
  testDir: './e2e',
  // One worker, so the tests share the server's database one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Each test starts from an empty outage table (e2e/fixtures.ts). The tests whose state that
  // reset cannot clear opt out of retries.
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
      // --env e2e reads .dev.vars.e2e instead of .dev.vars, so the server runs on the example values
      // the tests also read (e2e/dev-vars.ts), never a developer's own secrets.
      `node -e "require('node:fs').copyFileSync('.dev.vars.example','.dev.vars.e2e')"`,
      'npm run build',
      `npx wrangler d1 migrations apply DB --local --env e2e --persist-to ${STATE}`,
      // --env e2e: rate limits for a test suite rather than for readers (wrangler.toml).
      `npx wrangler dev --env e2e --port ${PORT} --persist-to ${STATE}`,
    ].join(' && '),
    url: `http://localhost:${PORT}${STATUS_PATH}`,
    timeout: 180_000,
    reuseExistingServer: false,
    // In CI the server's log (every request, and any error) is in the job output when a test fails.
    stdout: process.env.CI ? 'pipe' : 'ignore',
  },
});
