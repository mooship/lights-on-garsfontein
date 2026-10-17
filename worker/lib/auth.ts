import { safeEqual } from './crypto';
import { bearerToken, errors, isRateLimited } from './http';
import type { RouteContext } from './router';

/** Wrong or missing tokens share the login rate limit, so they cannot be brute-forced. */
export async function refuseBadToken({ env, limitKey }: RouteContext): Promise<Response> {
  if (await isRateLimited(env.LOGIN_LIMITER, limitKey)) return errors.rateLimited();
  return errors.unauthorized();
}

/**
 * Checks `Authorization: Bearer <token>` against a secret: null when no bearer header was sent,
 * otherwise whether it matches. An unset secret matches nothing.
 */
export async function checkBearer(request: Request, secret: string | undefined): Promise<boolean | null> {
  const token = bearerToken(request);
  if (token === null) return null;
  return secret ? safeEqual(token, secret) : false;
}

/** An `authorize` guard for bearer-token endpoints. An unset secret refuses every request. */
export function requireBearer(secretOf: (env: Env) => string | undefined) {
  return async (ctx: RouteContext): Promise<Response | null> => {
    if (await checkBearer(ctx.request, secretOf(ctx.env))) return null;
    return refuseBadToken(ctx);
  };
}
