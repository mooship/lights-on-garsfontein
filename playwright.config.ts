import { defineConfig, devices } from '@playwright/test';
import { STATUS_PATH } from './shared/paths';

const PORT = Number(process.env.E2E_PORT ?? 8788);
// A throwaway local D1 so every run starts empty.
const STATE = '.cloudflare/state';

export default defineConfig({
  testDir: './e2e',
  // One worker, so the tests share the server's database one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Each test starts from an empty outage table (e2e/fixtures.ts), so a retry does not inherit
  // the failed run's outages.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: [
      `node -e "require('node:fs').rmSync('${STATE}',{recursive:true,force:true})"`,
      // Mode e2e reads .dev.vars.e2e instead of .dev.vars, so the server runs on the example values
      // the tests also read (e2e/dev-vars.ts), never a developer's own secrets.
      `node -e "require('node:fs').copyFileSync('.dev.vars.example','.dev.vars.e2e')"`,
      'npm run build -- --mode e2e',
      `npx --no-install cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --local --mode e2e --dir drizzle --persist-to ${STATE}`,
      `npx --no-install vite preview --mode e2e --port ${PORT}`,
    ].join(' && '),
    url: `http://localhost:${PORT}${STATUS_PATH}`,
    timeout: 180_000,
    reuseExistingServer: false,
    // In CI the server's log (every request, and any error) is in the job output when a test fails.
    stdout: process.env.CI ? 'pipe' : 'ignore',
  },
});
