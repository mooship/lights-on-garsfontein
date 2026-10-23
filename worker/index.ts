import { API_PREFIX, OUTAGE_VIEWS } from '../shared/paths';
import { HOURLY_CRON } from './crons';
import { createDb } from './db/client';
import { type AlertJob, claimAlerts, enqueueAlerts, retryAlert } from './lib/alerts';
import { deliverAlertPage } from './lib/deliver';
import { detectOutage, purgeExpiredSessions } from './lib/grid';
import { errors } from './lib/http';
import { dispatch, purgeEdgeCache } from './lib/router';
import { deliverTelegramAlert, telegramConfigured } from './lib/telegram';
import { routes } from './routes';

// public/_headers only covers static assets; Worker responses (API, SEO) get these.
// None of them is HTML, so the CSP can forbid everything. HSTS matches public/_headers, which says why.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
};

function withSecurityHeaders(routed: Response): Response {
  // Re-wrap so headers are mutable (asset responses are immutable).
  const response = new Response(routed.body, routed);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  return response;
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  // HEAD runs the GET route; the runtime drops the body.
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const match = routes[`${method} ${url.pathname}`];
  if (match) return dispatch(match, request, env, ctx);
  if (url.pathname.startsWith(API_PREFIX)) return errors.notFound();
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return withSecurityHeaders(await route(request, env, ctx));
    } catch (error) {
      console.error('Unhandled error', error);
      return withSecurityHeaders(errors.internal());
    }
  },

  /** The two crons in worker/crons.ts. */
  async scheduled(controller, env) {
    const db = createDb(env.DB);
    const now = new Date(controller.scheduledTime);
    if (controller.cron === HOURLY_CRON) {
      await purgeExpiredSessions(db, now);
    } else {
      if (await detectOutage(db, now)) await purgeEdgeCache(env.SITE_URL, OUTAGE_VIEWS);
      await enqueueAlerts(db, env.PUSH_QUEUE, await claimAlerts(db, now), now, { telegram: telegramConfigured(env) });
    }
  },

  /** One page of an alert, or one Telegram alert, per message; see worker/lib/deliver.ts and telegram.ts. */
  // The queue has `max_retries = 0`, so a job that throws is re-queued here, or it would be lost.
  // Delivery throws only before anything is sent, so a retry never repeats an alert.
  async queue(batch, env) {
    for (const message of batch.messages) {
      const job = message.body;
      try {
        if ('channel' in job) await deliverTelegramAlert(job, env, new Date());
        else await deliverAlertPage(job, env, new Date());
      } catch (error) {
        // Only the name: a message can quote an endpoint or the Telegram token.
        const name = error instanceof Error ? error.name : typeof error;
        const retried = await retryAlert(env.PUSH_QUEUE, job);
        console.warn(
          `An alert job failed (${name}); ${retried ? 'retrying' : `gave up after ${job.attempt} attempts`}`,
        );
      }
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, AlertJob>;
