import { safeEqual } from './crypto';
import { bearerToken, errors, isRateLimited } from './http';
import type { RouteContext } from './router';

/** Wrong or missing tokens share the login rate limit, so they cannot be brute-forced. */
export async function refuseBadToken({ env, limitKey }: RouteContext): Promise<Response> {
  if (await isRateLimited(env.LOGIN_LIMITER, limitKey)) return errors.rateLimited();
  return errors.unauthorized();
}

/** An `authorize` guard for bearer-token endpoints. An unset secret refuses every request. */
export function requireBearer(secretOf: (env: Env) => string | undefined) {
  return async (ctx: RouteContext): Promise<Response | null> => {
    const secret = secretOf(ctx.env);
    const token = bearerToken(ctx.request);
    if (secret && token && (await safeEqual(token, secret))) return null;
    return refuseBadToken(ctx);
  };
}
