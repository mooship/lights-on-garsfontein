import { bindings, defineConfig, triggers } from 'cf/config';

// Copy this file to cloudflare.config.ts and replace the placeholders before deploying.
export default defineConfig((ctx) => {
  const isTest = ctx.mode === 'e2e';
  return {
    worker: {
      name: isTest ? 'lights-on-e2e' : '<WORKER_NAME>',
      compatibilityDate: '2026-10-01',
      entrypoint: 'worker/index.ts',
      workersDev: !isTest,
      previewUrls: true,
      placement: { mode: 'smart' },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        redactQueryString: false,
        logs: { enabled: true, headSamplingRate: 1, invocationLogs: true, persist: true },
        traces: { enabled: true, headSamplingRate: 1, persist: true },
        issues: { enabled: true },
      },
      assets: {
        notFoundHandling: '404-page',
        runWorkerFirst: [
          '/api/*',
          '/en',
          '/en/',
          '/admin',
          '/sitemap.xml',
          '/robots.txt',
          '/og.png',
          '/feed.xml',
          '/badge.svg',
          '/en/badge.svg',
        ],
      },
      domains: isTest ? [] : ['<YOUR_DOMAIN>'],
      triggers: [
        ...(isTest
          ? []
          : [triggers.scheduled({ schedule: '* * * * *' }), triggers.scheduled({ schedule: '0 * * * *' })]),
        triggers.queue({ maxBatchSize: 1, maxRetries: 0, name: isTest ? 'lights-on-push-e2e' : 'lights-on-push' }),
      ],
      env: {
        SITE_URL: bindings.text(isTest ? 'http://localhost:8787' : '<SITE_URL>'),
        TURNSTILE_SITE_KEY: bindings.text(isTest ? '1x00000000000000000000AA' : '<TURNSTILE_SITE_KEY>'),
        TURNSTILE_SECRET_KEY: bindings.secret(),
        ADMIN_PASSWORD_HASH: bindings.secret(),
        HEARTBEAT_TOKEN: bindings.secret(),
        ADMIN_API_TOKEN: bindings.secret(),
        ADMIN_USERNAME: bindings.secret(),
        CONTACT_EMAIL: bindings.secret(),
        VAPID_PRIVATE_KEY: bindings.secret(),
        TELEGRAM_BOT_TOKEN: bindings.secret(),
        TELEGRAM_CHAT_ID: bindings.secret(),
        TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
        DB: bindings.d1({
          name: isTest ? 'e2e-local' : '<DATABASE_NAME>',
          id: isTest ? '11111111-1111-4111-8111-111111111111' : '<D1_DATABASE_ID>',
        }),
        PUSH_QUEUE: bindings.queue({ name: isTest ? 'lights-on-push-e2e' : 'lights-on-push' }),
        STATUS_LIMITER: bindings.rateLimit({
          namespace: isTest ? '4511' : '4501',
          simple: { limit: isTest ? 10000 : 60, period: 60 },
        }),
        CONTACT_LIMITER: bindings.rateLimit({
          namespace: isTest ? '4512' : '4502',
          simple: { limit: isTest ? 10 : 5, period: 60 },
        }),
        LOGIN_LIMITER: bindings.rateLimit({
          namespace: isTest ? '4513' : '4503',
          simple: { limit: 5, period: 60 },
        }),
        LOGIN_GLOBAL_LIMITER: bindings.rateLimit({
          namespace: isTest ? '4514' : '4504',
          simple: { limit: 30, period: 60 },
        }),
        PUSH_LIMITER: bindings.rateLimit({
          namespace: isTest ? '4515' : '4505',
          simple: { limit: isTest ? 10 : 5, period: 60 },
        }),
        ASSETS: bindings.assets(),
      },
    },
  };
});
