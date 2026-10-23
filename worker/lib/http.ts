import { z } from 'zod';
import { MINUTE_MS, SECOND_MS } from '../../shared/api';
import { ERROR, type ErrorCode } from '../../shared/errors';

/**
 * How long a call to another service (push, Telegram, Turnstile) may take, as an `AbortSignal.timeout`,
 * so one that hangs cannot hold a request or a queue job open.
 */
export const FETCH_TIMEOUT_MS = 10 * SECOND_MS;
/** A JSON response, `no-store` unless `headers` sets its own Cache-Control. */
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

/** Every API error response: `{ error }` with an ErrorCode, plus the zod issues as `details` on a bad request. */
export const errors = {
  badRequest: (error: ErrorCode = ERROR.badRequest, details?: unknown) => json({ error, details }, 400),
  unauthorized: () => json({ error: ERROR.unauthorized }, 401),
  forbidden: (error: ErrorCode = ERROR.forbidden) => json({ error }, 403),
  notFound: (error: ErrorCode = ERROR.notFound) => json({ error }, 404),
  conflict: (error: ErrorCode) => json({ error }, 409),
  unsupportedMediaType: () => json({ error: ERROR.unsupportedMediaType }, 415),
  payloadTooLarge: () => json({ error: ERROR.payloadTooLarge }, 413),
  rateLimited: () => json({ error: ERROR.rateLimited }, 429, { 'Retry-After': String(MINUTE_MS / 1000) }),
  internal: () => json({ error: ERROR.internal }, 500),
};

/** The token from `Authorization: Bearer <token>` ('' when empty), or null without a bearer header. */
export function bearerToken(request: Request): string | null {
  // The scheme is case-insensitive (RFC 9110), so a sensor's client may send "bearer".
  return /^bearer +(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? null;
}

export const CLIENT_IP_HEADER = 'CF-Connecting-IP';

/** For rate limits and Turnstile only; never stored. */
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

/** An ISO 8601 time with an offset, normalised to UTC. */
export const isoTime = () => z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());

/** The largest request body read; the largest real one, a push subscription, is a few kilobytes. */
export const MAX_BODY_BYTES = 16 * 1024;

/** The body as text, or null when it is over MAX_BODY_BYTES. */
// Refused up front by its Content-Length, and a chunked body as soon as it passes the limit, so an
// oversized body is never held whole.
export async function readCappedText(request: Request): Promise<string | null> {
  if (!request.body) return '';
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return null;
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return null;
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** Parses a JSON body against a schema; on failure returns the 400 (or 413) to send instead. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  const text = await readCappedText(request);
  if (text === null) return { response: errors.payloadTooLarge() };
  let body: unknown;
  try {
    body = JSON.parse(text);
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

export const isJson = (type: string) => type.split(';')[0]?.trim().toLowerCase() === 'application/json';

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
