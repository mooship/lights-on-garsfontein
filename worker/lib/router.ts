import { createDb, type Db } from '../db/client';
import { clientIp, errors, isCrossOrigin, isRateLimited, rateLimitKey } from './http';

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  db: Db;
  ip: string;
  /** Key for per-connection rate limits (IPv6 grouped by /64). */
  limitKey: string;
}

/**
 * One API endpoint. Guards are declared here and applied by `dispatch` in a fixed order
 * (same-origin, rate limit, admin auth), so handlers contain only their own logic.
 */
export interface Route {
  handler: (ctx: RouteContext) => Promise<Response> | Response;
  /** Reject requests whose Origin is another site (cookie-authenticated writes). */
  sameOrigin?: boolean;
  /** Per-IP rate limit checked before anything else touches the request. */
  limiter?: 'STATUS_LIMITER' | 'CONFIRM_LIMITER' | 'LOGIN_LIMITER';
  /** Return a Response to refuse the request, or null to let it through (e.g. admin auth). */
  authorize?: (ctx: RouteContext) => Promise<Response | null>;
  /** Open data: any site's browser may read the response. */
  cors?: boolean;
}

/** Keyed by "METHOD /path", e.g. "GET /api/status". */
export type Routes = Record<string, Route>;

export async function dispatch(route: Route, request: Request, env: Env, url: URL): Promise<Response> {
  const ip = clientIp(request);
  const ctx: RouteContext = { request, env, url, db: createDb(env.DB), ip, limitKey: rateLimitKey(ip) };
  let response: Response | null = null;
  if (route.sameOrigin && isCrossOrigin(request)) response = errors.forbidden();
  else if (route.limiter && (await isRateLimited(env[route.limiter], ctx.limitKey))) response = errors.rateLimited();
  else if (route.authorize) response = await route.authorize(ctx);
  response ??= await route.handler(ctx);
  if (route.cors) response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}
