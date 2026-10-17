import { defineConfig, devices } from '@playwright/test';
import { exampleVar } from './e2e/dev-vars';

const PORT = 8788;
// A throwaway local D1 so every run starts empty.
const STATE = '.wrangler/e2e-state';
// The .dev.vars.example values: a real contact address set in .dev.vars is never used, and the
// tests know the admin API token they reset the database with (e2e/fixtures.ts).
const VARS = ['CONTACT_EMAIL', 'ADMIN_API_TOKEN'].map((name) => `--var ${name}:${exampleVar(name)}`).join(' ');

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
      'npm run build',
      `npx wrangler d1 migrations apply DB --local --env e2e --persist-to ${STATE}`,
      // --env e2e: rate limits for a test suite rather than for readers (wrangler.toml).
      `npx wrangler dev --env e2e --port ${PORT} --persist-to ${STATE} ${VARS}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/api/status`,
    timeout: 180_000,
    reuseExistingServer: false,
    // In CI the server's log (every request, and any error) is in the job output when a test fails.
    stdout: process.env.CI ? 'pipe' : 'ignore',
  },
});
