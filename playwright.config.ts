import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;
// A throwaway local D1 so every run starts empty.
const STATE = '.wrangler/e2e-state';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
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
      'npm run build',
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE}`,
      `npx wrangler dev --port ${PORT} --persist-to ${STATE}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/api/status`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
