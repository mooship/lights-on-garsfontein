import type { z } from 'zod';
import { MINUTE_MS } from '../../shared/api';
import { ERROR, type ErrorCode } from '../../shared/errors';

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** Cache-Control for a public response that any cache may keep for `ms`. */
export const publicCache = (ms: number) => `public, max-age=${ms / 1000}`;

export const errors = {
  badRequest: (error: ErrorCode = ERROR.badRequest, details?: unknown) => json({ error, details }, 400),
  unauthorized: () => json({ error: ERROR.unauthorized }, 401),
  forbidden: (error: ErrorCode = ERROR.forbidden) => json({ error }, 403),
  notFound: () => json({ error: ERROR.notFound }, 404),
  conflict: (error: ErrorCode) => json({ error }, 409),
  unsupportedMediaType: () => json({ error: ERROR.unsupportedMediaType }, 415),
  rateLimited: () => json({ error: ERROR.rateLimited }, 429, { 'Retry-After': String(MINUTE_MS / 1000) }),
  internal: () => json({ error: ERROR.internal }, 500),
};

/** The token from `Authorization: Bearer <token>` ('' when empty), or null without a bearer header. */
export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

export const CLIENT_IP_HEADER = 'CF-Connecting-IP';

export function clientIp(request: Request): string {
  return request.headers.get(CLIENT_IP_HEADER) ?? '127.0.0.1';
}

/**
 * Rate-limit key for a connection: the IPv4 address, or the /64 prefix for IPv6 (one
 * household usually gets a whole /64, so per-address limits would be trivial to dodge).
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

export async function isRateLimited(limiter: RateLimit, key: string): Promise<boolean> {
  const { success } = await limiter.limit({ key });
  return !success;
}

/** Parses a JSON body against a schema; returns a 400 Response on failure. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: errors.badRequest(ERROR.invalidJson) };
  }
  const result = schema.safeParse(body);
  if (!result.success) return { response: errors.badRequest(ERROR.badRequest, result.error.issues) };
  return { data: result.data };
}

/** True when the browser says the request came from another site (Origin or Sec-Fetch-Site). */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) return true;
  const site = request.headers.get('Sec-Fetch-Site');
  return site !== null && site !== 'same-origin' && site !== 'none';
}

const isJson = (type: string) => type.split(';')[0]?.trim().toLowerCase() === 'application/json';

/**
 * Guard for cookie-authenticated writes: refuses other sites, and bodies that are not JSON
 * (an HTML form can post cross-site without a CORS preflight; JSON cannot). A request with no
 * body at all, such as sign-out, may leave out the Content-Type. Returns null when allowed.
 */
export function refuseCrossSite(request: Request): Response | null {
  if (isCrossSite(request)) return errors.forbidden();
  const type = request.headers.get('Content-Type');
  const hasBody = request.body !== null && request.headers.get('Content-Length') !== '0';
  if (type === null ? hasBody : !isJson(type)) return errors.unsupportedMediaType();
  return null;
}
