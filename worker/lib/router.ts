import { createDb, type Db } from '../db/client';
import { clientIp, errors, isRateLimited, rateLimitKey, refuseCrossSite } from './http';

export interface RouteContext {
  request: Request;
  env: Env;
  db: Db;
  ip: string;
  /** Key for per-connection rate limits (IPv6 grouped by /64). */
  limitKey: string;
  /** Extra headers added to whatever response the route returns, e.g. a refreshed session cookie. */
  headers: Headers;
}

/**
 * One API endpoint. Guards are declared here and applied by `dispatch` in a fixed order
 * (same-origin, rate limit, admin auth), so handlers contain only their own logic.
 */
export interface Route {
  handler: (ctx: RouteContext) => Promise<Response> | Response;
  /** Reject cross-site requests and non-JSON bodies (cookie-authenticated writes). */
  sameOrigin?: boolean;
  /** Per-IP rate limit checked before anything else touches the request. */
  limiter?: 'STATUS_LIMITER' | 'CONFIRM_LIMITER' | 'LOGIN_LIMITER';
  /** Return a Response to refuse the request, or null to let it through (e.g. admin auth). */
  authorize?: (ctx: RouteContext) => Promise<Response | null>;
  /** Open data: any site's browser may read the response. */
  cors?: boolean;
  /** Serve GETs from the edge cache for as long as the response's own Cache-Control allows. */
  edgeCache?: boolean;
}

/** Keyed by "METHOD /path", e.g. "GET /api/status". */
export type Routes = Record<string, Route>;

/**
 * Answers from the Cache API when it can, else runs the handler and stores its response. The key
 * is the origin and path only, so query strings cannot be used to skip the cache. Rate limits
 * still run first: the cache saves D1 work, not requests.
 */
async function fromEdgeCache(ctx: RouteContext, handler: Route['handler']): Promise<Response> {
  const { origin, pathname } = new URL(ctx.request.url);
  const key = new Request(`${origin}${pathname}`);
  const hit = await caches.default.match(key);
  // Re-wrap so dispatch can add headers (cached responses are immutable).
  if (hit) return new Response(hit.body, hit);
  const response = await handler(ctx);
  if (response.ok) await caches.default.put(key, response.clone());
  return response;
}

export async function dispatch(route: Route, request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  const ctx: RouteContext = {
    request,
    env,
    db: createDb(env.DB),
    ip,
    limitKey: rateLimitKey(ip),
    headers: new Headers(),
  };
  let response = route.sameOrigin ? refuseCrossSite(request) : null;
  if (!response && route.limiter && (await isRateLimited(env[route.limiter], ctx.limitKey))) {
    response = errors.rateLimited();
  }
  if (!response && route.authorize) response = await route.authorize(ctx);
  response ??=
    route.edgeCache && request.method === 'GET' ? await fromEdgeCache(ctx, route.handler) : await route.handler(ctx);
  if (route.cors) response.headers.set('Access-Control-Allow-Origin', '*');
  for (const [name, value] of ctx.headers) response.headers.append(name, value);
  return response;
}
