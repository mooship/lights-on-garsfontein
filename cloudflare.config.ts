import { bindings, defineConfig, triggers } from 'cf/config';

export default defineConfig((ctx) => {
  switch (ctx.mode) {
    case 'e2e': {
      return {
        worker: {
          name: 'garsfontein-grid-e2e',
          compatibilityDate: '2026-10-01',
          entrypoint: 'worker/index.ts',
          workersDev: false,
          previewUrls: true,
          placement: {
            mode: 'smart',
          },
          observability: {
            enabled: true,
            headSamplingRate: 1,
            redactQueryString: false,
            logs: {
              enabled: true,
              headSamplingRate: 1,
              invocationLogs: true,
              persist: true,
            },
            traces: {
              enabled: true,
              headSamplingRate: 1,
              persist: true,
            },
            issues: {
              enabled: true,
            },
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
          triggers: [
            triggers.queue({
              maxBatchSize: 1,
              maxRetries: 0,
              name: 'lights-on-push-e2e',
            }),
          ],
          env: {
            SITE_URL: bindings.text(String('http://localhost:8787')),
            TURNSTILE_SITE_KEY: bindings.text(String('1x00000000000000000000AA')),
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
              name: 'e2e-local',
              id: '11111111-1111-4111-8111-111111111111',
            }),
            PUSH_QUEUE: bindings.queue({
              name: 'lights-on-push-e2e',
            }),
            STATUS_LIMITER: bindings.rateLimit({
              namespace: '4511',
              simple: {
                limit: 10000,
                period: 60,
              },
            }),
            CONTACT_LIMITER: bindings.rateLimit({
              namespace: '4512',
              simple: {
                limit: 10,
                period: 60,
              },
            }),
            LOGIN_LIMITER: bindings.rateLimit({
              namespace: '4513',
              simple: {
                limit: 5,
                period: 60,
              },
            }),
            LOGIN_GLOBAL_LIMITER: bindings.rateLimit({
              namespace: '4514',
              simple: {
                limit: 30,
                period: 60,
              },
            }),
            PUSH_LIMITER: bindings.rateLimit({
              namespace: '4515',
              simple: {
                limit: 10,
                period: 60,
              },
            }),
            ASSETS: bindings.assets(),
          },
        },
      };
    }
    default: {
      return {
        worker: {
          name: 'garsfontein-grid',
          compatibilityDate: '2026-10-01',
          entrypoint: 'worker/index.ts',
          workersDev: false,
          previewUrls: true,
          placement: {
            mode: 'smart',
          },
          observability: {
            enabled: true,
            headSamplingRate: 1,
            redactQueryString: false,
            logs: {
              enabled: true,
              headSamplingRate: 1,
              invocationLogs: true,
              persist: true,
            },
            traces: {
              enabled: true,
              headSamplingRate: 1,
              persist: true,
            },
            issues: {
              enabled: true,
            },
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
          domains: ['garsfontein.timothybrits.co.za'],
          triggers: [
            triggers.scheduled({
              schedule: '* * * * *',
            }),
            triggers.scheduled({
              schedule: '0 * * * *',
            }),
            triggers.queue({
              maxBatchSize: 1,
              maxRetries: 0,
              name: 'lights-on-push',
            }),
          ],
          env: {
            SITE_URL: bindings.text(String('https://garsfontein.timothybrits.co.za')),
            TURNSTILE_SITE_KEY: bindings.text(String('0x4AAAAAAFZLuwPL3UZam75R')),
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
              name: 'garsfontein-grid',
              id: '6374fa3a-827f-42f4-910f-8ff9415a1259',
            }),
            PUSH_QUEUE: bindings.queue({
              name: 'lights-on-push',
            }),
            STATUS_LIMITER: bindings.rateLimit({
              namespace: '4501',
              simple: {
                limit: 60,
                period: 60,
              },
            }),
            CONTACT_LIMITER: bindings.rateLimit({
              namespace: '4502',
              simple: {
                limit: 5,
                period: 60,
              },
            }),
            LOGIN_LIMITER: bindings.rateLimit({
              namespace: '4503',
              simple: {
                limit: 5,
                period: 60,
              },
            }),
            LOGIN_GLOBAL_LIMITER: bindings.rateLimit({
              namespace: '4504',
              simple: {
                limit: 30,
                period: 60,
              },
            }),
            PUSH_LIMITER: bindings.rateLimit({
              namespace: '4505',
              simple: {
                limit: 5,
                period: 60,
              },
            }),
            ASSETS: bindings.assets(),
          },
        },
      };
    }
  }
});
