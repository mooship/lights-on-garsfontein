import { API_PREFIX, OUTAGE_VIEWS } from '../shared/paths';
import { HOURLY_CRON } from './crons';
import { createDb } from './db/client';
import {
  type AlertJob,
  claimAlerts,
  enqueueAlerts,
  enqueueTelegramAlerts,
  retryAlert,
  TELEGRAM_CHANNEL,
} from './lib/alerts';
import { deliverAlertPage } from './lib/deliver';
import { detectOutage, purgeExpiredSessions } from './lib/grid';
import { errorName, errors } from './lib/http';
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
      // Telegram first, the sooner of the two; each channel has its own claims, so one failing never holds back the other.
      const telegram = async () =>
        enqueueTelegramAlerts(db, env.PUSH_QUEUE, await claimAlerts(db, now, TELEGRAM_CHANNEL), now);
      const push = async () => enqueueAlerts(db, env.PUSH_QUEUE, await claimAlerts(db, now), now);
      const results = await Promise.allSettled(telegramConfigured(env) ? [telegram(), push()] : [push()]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
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
        const retried = await retryAlert(env.PUSH_QUEUE, job);
        console.warn(
          `An alert job failed (${errorName(error)}); ${retried ? 'retrying' : `gave up after ${job.attempt} attempts`}`,
        );
      }
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, AlertJob>;
