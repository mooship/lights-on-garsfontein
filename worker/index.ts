import { OUTAGE_VIEWS } from '../shared/paths';
import { createDb } from './db/client';
import { detectOutage, purgeExpiredSessions, purgeOldFingerprints, purgeOldStillOffReports } from './lib/grid';
import { errors } from './lib/http';
import { dispatch, purgeEdgeCache, type Routes } from './lib/router';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { contactRoutes } from './routes/contact';
import { historyRoutes } from './routes/history';
import { seoRoutes } from './routes/seo';
import { statusRoutes } from './routes/status';

/** Must match the hourly cron in wrangler.toml. */
const HOURLY_CRON = '0 * * * *';

/**
 * Every Worker endpoint. Adding one means: its handler in a file under
 * routes/, its route map spread here, the path in wrangler's `assets.run_worker_first` if it is
 * outside /api/, and the path in vite.config.ts's dev `server.proxy`.
 */
const routes: Routes = {
  ...statusRoutes,
  ...historyRoutes,
  ...authRoutes,
  ...adminRoutes,
  ...seoRoutes,
  ...contactRoutes,
};

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
      await Promise.all([
        purgeExpiredSessions(db, now),
        purgeOldFingerprints(db, now),
        purgeOldStillOffReports(db, now),
      ]);
    } else {
      const { opened } = await detectOutage(db, now);
      if (opened) await purgeEdgeCache(env.SITE_URL, OUTAGE_VIEWS);
    }
  },
} satisfies ExportedHandler<Env>;
