import { createDb } from './db/client';
import { detectOutage, purgeExpiredSessions } from './lib/grid';
import { errors, json } from './lib/http';
import { handleAdminRoutes } from './routes/admin';
import { handleAuthRoutes } from './routes/auth';
import { handleHistoryRoutes } from './routes/history';
import { handleSeoRoutes } from './routes/seo';
import { handleStatusRoutes } from './routes/status';

const routers = [handleStatusRoutes, handleHistoryRoutes, handleAuthRoutes, handleAdminRoutes, handleSeoRoutes];

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
  for (const router of routers) {
    const response = await router(request, env, url);
    if (response) return response;
  }
  if (url.pathname.startsWith('/api/')) return errors.notFound();
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (error) {
      console.error('Unhandled error', error);
      return withSecurityHeaders(json({ error: 'internal_error' }, 500));
    }
  },

  async scheduled(controller, env) {
    const db = createDb(env.DB);
    const now = new Date(controller.scheduledTime);
    await Promise.all([detectOutage(db, now), purgeExpiredSessions(db, now)]);
  },
} satisfies ExportedHandler<Env>;
