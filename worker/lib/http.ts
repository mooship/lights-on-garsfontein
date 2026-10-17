import type { z } from 'zod';

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

export const errors = {
  badRequest: (details?: unknown) => json({ error: 'bad_request', details }, 400),
  unauthorized: () => json({ error: 'unauthorized' }, 401),
  forbidden: (error = 'forbidden') => json({ error }, 403),
  notFound: () => json({ error: 'not_found' }, 404),
  conflict: (error: string) => json({ error }, 409),
  rateLimited: () => json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' }),
  internal: () => json({ error: 'internal_error' }, 500),
};

/** The token from `Authorization: Bearer <token>` ('' when empty), or null without a bearer header. */
export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? '127.0.0.1';
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
    return { response: errors.badRequest('invalid_json') };
  }
  const result = schema.safeParse(body);
  if (!result.success) return { response: errors.badRequest(result.error.issues) };
  return { data: result.data };
}

/** Rejects cross-site state-changing requests when the browser sends an Origin. */
export function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin !== null && origin !== new URL(request.url).origin;
}

/** Read-only open data (status, stats, CSV) may be fetched by any site's browser. */
export const PUBLIC_CORS = { 'Access-Control-Allow-Origin': '*' } as const;
