import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Istanbul, not V8: V8 coverage does not work inside workerd. Run on demand (npm run test:coverage).
    coverage: { provider: 'istanbul', include: ['worker/**', 'shared/**'] },
    projects: [
      {
        // The Worker, in workerd with D1 (test/*.test.ts).
        plugins: [
          cloudflareTest(async () => ({
            main: './worker/index.ts',
            wrangler: { configPath: './wrangler.toml' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations('./drizzle'),
                SITE_URL: 'https://garsfontein.example',
                TURNSTILE_SITE_KEY: 'test-site-key',
                TURNSTILE_SECRET_KEY: 'test-secret',
                // Hash of "test-password".
                ADMIN_PASSWORD_HASH:
                  'pbkdf2_sha256$100000$n7SohUIkjgbP01xFrUR50w==$G4dp7lkqVXazO3SBFzPjLKXgdzhDeh99ZXefTHRlxEg=',
                ADMIN_USERNAME: 'admin',
                HEARTBEAT_TOKEN: 'test-heartbeat-token',
                ADMIN_API_TOKEN: 'test-admin-api-token',
                IP_SALT: 'test-salt',
              },
            },
          })),
        ],
        test: {
          name: 'worker',
          include: ['test/*.test.ts'],
          setupFiles: ['./test/setup.ts'],
          // sameWindow() (test/helpers.ts) can wait up to 10 s before a rate-limit loop.
          testTimeout: 20_000,
        },
      },
      {
        // The app's pure logic, the build helpers and the built site, in Node (test/node/).
        test: {
          name: 'node',
          include: ['test/node/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./test/node/setup.ts'],
        },
      },
    ],
  },
});
