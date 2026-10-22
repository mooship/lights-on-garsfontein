import { API_PREFIX, OUTAGE_VIEWS } from '../shared/paths';
import { HOURLY_CRON } from './crons';
import { createDb } from './db/client';
import { type AlertPage, claimAlerts, enqueueAlerts } from './lib/alerts';
import { deliverAlertPage } from './lib/deliver';
import { detectOutage, purgeExpiredSessions } from './lib/grid';
import { errors } from './lib/http';
import { dispatch, purgeEdgeCache } from './lib/router';
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

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // HEAD runs the GET route; the runtime drops the body.
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const match = routes[`${method} ${url.pathname}`];
  if (match) return dispatch(match, request, env);
  if (url.pathname.startsWith(API_PREFIX)) return errors.notFound();
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return withSecurityHeaders(await route(request, env));
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
      await enqueueAlerts(db, env.PUSH_QUEUE, await claimAlerts(db, now), now);
    }
  },

  /** One page of an alert per message; see worker/lib/deliver.ts. */
  async queue(batch, env) {
    for (const message of batch.messages) {
      await deliverAlertPage(message.body, env, new Date());
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, AlertPage>;
