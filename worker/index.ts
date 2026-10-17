import { createDb } from './db/client';
import { detectOutage, purgeExpiredSessions, purgeOldFingerprints } from './lib/grid';
import { errors } from './lib/http';
import { dispatch, purgeEdgeCache, type Routes } from './lib/router';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { historyRoutes } from './routes/history';
import { seoRoutes } from './routes/seo';
import { STATUS_PATH, statusRoutes } from './routes/status';

/** The hourly housekeeping cron in wrangler.toml. */
const HOURLY_CRON = '0 * * * *';

/** Every Worker endpoint, keyed by "METHOD /path". */
const routes: Routes = { ...statusRoutes, ...historyRoutes, ...authRoutes, ...adminRoutes, ...seoRoutes };

// public/_headers only covers static assets; Worker responses (API, SEO) get these.
// None of them is HTML, so the CSP can forbid everything.
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
  const match = routes[`${request.method} ${url.pathname}`];
  if (match) return dispatch(match, request, env);
  if (url.pathname.startsWith('/api/')) return errors.notFound();
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

  /** Two crons (wrangler.toml): outage detection every minute, housekeeping every hour. */
  async scheduled(controller, env) {
    const db = createDb(env.DB);
    const now = new Date(controller.scheduledTime);
    if (controller.cron === HOURLY_CRON) {
      await Promise.all([purgeExpiredSessions(db, now), purgeOldFingerprints(db, now)]);
    } else {
      // Purges only this datacentre's copy; elsewhere the status edge TTL bounds the delay.
      const { opened } = await detectOutage(db, now);
      if (opened) await purgeEdgeCache(env.SITE_URL, STATUS_PATH);
    }
  },
} satisfies ExportedHandler<Env>;
