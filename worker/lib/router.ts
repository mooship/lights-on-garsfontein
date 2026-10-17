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
  /** Per-connection rate limit, checked before auth and the handler. */
  limiter?: 'STATUS_LIMITER' | 'CONFIRM_LIMITER' | 'LOGIN_LIMITER';
  /** Return a Response to refuse the request, or null to let it through (e.g. admin auth). */
  authorize?: (ctx: RouteContext) => Promise<Response | null>;
  /** Open data: any site's browser may read the response. */
  cors?: boolean;
  /**
   * Serve GETs from the edge cache: `true` for as long as the response's own Cache-Control
   * allows, or a number of seconds at the edge only, while browsers get the response's own header.
   */
  edgeCache?: boolean | number;
  /** Edge-cached paths to purge after a successful response, because this write changes them. */
  purges?: readonly string[];
}

/** Keyed by "METHOD /path", e.g. "GET /api/status". */
export type Routes = Record<string, Route>;

/** Holds the browser's Cache-Control on a copy stored with an edge-only TTL; never sent out. */
const BROWSER_CACHE_CONTROL = 'X-Browser-Cache-Control';

/** The origin and path only, so query strings cannot be used to skip the cache. */
const edgeCacheKey = (origin: string, path: string) => new Request(`${origin}${path}`);

/**
 * Drops edge-cached paths. The Cache API is per datacentre, so this clears only the one running
 * the Worker; other datacentres keep their copy until its TTL runs out.
 */
export async function purgeEdgeCache(origin: string, paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => caches.default.delete(edgeCacheKey(origin, path))));
}

/**
 * Answers from the Cache API when it can, else runs the handler and stores its response. Rate
 * limits still run first: the cache saves D1 work, not requests. With an edge TTL the stored copy
 * gets `s-maxage` (the Cache API honours it, and would not store `no-store` at all), and the
 * response's own Cache-Control is put back before anything reaches the browser.
 */
async function fromEdgeCache(ctx: RouteContext, handler: Route['handler'], ttl: true | number): Promise<Response> {
  const { origin, pathname } = new URL(ctx.request.url);
  const key = edgeCacheKey(origin, pathname);
  const hit = await caches.default.match(key);
  if (hit) {
    // Re-wrap so dispatch can add headers (cached responses are immutable).
    const response = new Response(hit.body, hit);
    const browser = response.headers.get(BROWSER_CACHE_CONTROL);
    if (browser !== null) {
      response.headers.set('Cache-Control', browser);
      response.headers.delete(BROWSER_CACHE_CONTROL);
    }
    return response;
  }
  const response = await handler(ctx);
  if (!response.ok) return response;
  const stored = response.clone();
  if (ttl !== true) {
    stored.headers.set(BROWSER_CACHE_CONTROL, response.headers.get('Cache-Control') ?? 'no-store');
    stored.headers.set('Cache-Control', `public, s-maxage=${ttl}`);
  }
  await caches.default.put(key, stored);
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
  if (!response) {
    const { edgeCache, purges } = route;
    response =
      edgeCache && request.method === 'GET'
        ? await fromEdgeCache(ctx, route.handler, edgeCache)
        : await route.handler(ctx);
    if (purges && response.ok) await purgeEdgeCache(new URL(request.url).origin, purges);
  }
  if (route.cors) response.headers.set('Access-Control-Allow-Origin', '*');
  for (const [name, value] of ctx.headers) response.headers.append(name, value);
  return response;
}
