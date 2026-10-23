import { createDb, type Db } from '../db/client';
import { bearerToken, clientIp, errors, isRateLimited, rateLimitKey, refuseCrossSite } from './http';

export interface RouteContext {
  request: Request;
  env: Env;
  db: Db;
  /** The client's address, for rate limits and Turnstile only; never stored. */
  ip: string;
  /** Key for per-connection rate limits (IPv6 grouped by /64). */
  limitKey: string;
  /** Extra headers added to whatever response the route returns, e.g. a refreshed session cookie. */
  headers: Headers;
}

/** The name of every rate-limit binding in Env. */
type Limiter = { [K in keyof Env]: Env[K] extends RateLimit ? K : never }[keyof Env];

/**
 * One API endpoint. Guards are declared here and applied by `dispatch` in a fixed order
 * (cross-site, edge cache, rate limit, auth), so handlers contain only their own logic.
 */
export interface Route {
  handler: (ctx: RouteContext) => Promise<Response> | Response;
  /** Per-connection rate limit; on an edge-cached route only a cache miss counts. */
  limiter?: Limiter;
  /** Return a Response to refuse the request, or null to let it through (e.g. admin auth). */
  authorize?: (ctx: RouteContext) => Promise<Response | null>;
  /** Open data: any site's browser may read the response. */
  cors?: boolean;
  /**
   * Serve GETs from the edge cache: `true` for as long as the response's own Cache-Control
   * allows, or a number of seconds at the edge only, while browsers get the response's own header.
   */
  edgeCache?: true | number;
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

const cacheKeyOf = (request: Request) => {
  const { origin, pathname } = new URL(request.url);
  return edgeCacheKey(origin, pathname);
};

/** The stored copy for this path, with the browser's Cache-Control put back, or null on a miss. */
async function edgeCacheHit(request: Request): Promise<Response | null> {
  const hit = await caches.default.match(cacheKeyOf(request));
  if (!hit) return null;
  // Re-wrap so dispatch can add headers (cached responses are immutable).
  const response = new Response(hit.body, hit);
  const browser = response.headers.get(BROWSER_CACHE_CONTROL);
  if (browser !== null) {
    response.headers.set('Cache-Control', browser);
    response.headers.delete(BROWSER_CACHE_CONTROL);
  }
  return response;
}

/**
 * Stores a successful response for the next reader. With an edge TTL the stored copy gets
 * `s-maxage` (the Cache API honours it, and would not store `no-store` at all), and the response's
 * own Cache-Control is put back before anything reaches the browser.
 */
async function storeInEdgeCache(request: Request, response: Response, ttl: true | number): Promise<void> {
  if (!response.ok) return;
  const stored = response.clone();
  if (ttl !== true) {
    stored.headers.set(BROWSER_CACHE_CONTROL, response.headers.get('Cache-Control') ?? 'no-store');
    stored.headers.set('Cache-Control', `public, s-maxage=${ttl}`);
  }
  await caches.default.put(cacheKeyOf(request), stored);
}

/**
 * Every write gets refuseCrossSite, as only a browser attaches cookies on its own, except a bearer
 * request (a script or the sensor) to a route whose `authorize` checks that token.
 */
const needsSameSite = (route: Route, request: Request) =>
  request.method !== 'GET' && request.method !== 'HEAD' && !(route.authorize && bearerToken(request) !== null);

/**
 * Runs a matched route: its guards, the handler (or edge cache), purges, then CORS and `ctx.headers`.
 * A miss is stored in the edge cache after the response is sent (`execution.waitUntil`); a purge is
 * awaited, so the next read after a write never gets the old copy.
 */
export async function dispatch(
  route: Route,
  request: Request,
  env: Env,
  execution: ExecutionContext,
): Promise<Response> {
  const ip = clientIp(request);
  const ctx: RouteContext = {
    request,
    env,
    db: createDb(env.DB),
    ip,
    limitKey: rateLimitKey(ip),
    headers: new Headers(),
  };
  const { edgeCache, purges } = route;
  const cacheable = request.method === 'GET' && !route.authorize ? edgeCache || null : null;
  let response = needsSameSite(route, request) ? refuseCrossSite(request) : null;
  // A cached copy before the limit: a refused request has already reached the Worker, so the limit
  // only saves the D1 work behind a miss, and readers sharing one address (a mobile carrier's) all
  // check at once during an outage.
  if (!response && cacheable !== null) response = await edgeCacheHit(request);
  if (!response && route.limiter && (await isRateLimited(env[route.limiter], ctx.limitKey))) {
    response = errors.rateLimited();
  }
  if (!response && route.authorize) response = await route.authorize(ctx);
  if (!response) {
    response = await route.handler(ctx);
    if (cacheable !== null) execution.waitUntil(storeInEdgeCache(request, response, cacheable));
    if (purges && response.ok) await purgeEdgeCache(new URL(request.url).origin, purges);
  }
  if (route.cors) response.headers.set('Access-Control-Allow-Origin', '*');
  for (const [name, value] of ctx.headers) response.headers.append(name, value);
  return response;
}
