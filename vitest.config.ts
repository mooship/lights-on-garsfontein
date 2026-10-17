import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
          HEARTBEAT_TOKEN: 'test-heartbeat-token',
          IP_SALT: 'test-salt',
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
