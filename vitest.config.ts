import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Istanbul, not V8: V8 coverage does not work inside workerd. Both projects count towards one report.
    coverage: {
      provider: 'istanbul',
      include: ['worker/**', 'shared/**'],
      // The rest is defensive code that nothing can reach, such as a `?? 0` behind an index that is always in range.
      thresholds: { statements: 95, branches: 95, functions: 100, lines: 100 },
    },
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
                VAPID_PRIVATE_KEY:
                  '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"-3Hp4KVoMjPEi9JbtKlFpP-QnlseRduXTOFZdyXyA20","y":"eDeNwmF2tJG0I2WpQfhHy5ydPHz6zyO7bzffyHoNzjQ","crv":"P-256","d":"9dxzmBrrYXeQGoMXkFCuPw3hGBggRaDrc4ffWOBJyrE"}',
              },
            },
          })),
        ],
        test: {
          name: 'worker',
          include: ['test/*.test.ts'],
          setupFiles: ['./test/setup.ts'],
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
