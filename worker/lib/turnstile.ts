import { z } from 'zod';
import type { TurnstileAction } from '../../shared/api';
import { errors } from './http';
import type { RouteContext } from './router';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's public test secrets (1x always passes, 2x fails, 3x "already spent"); used in dev and E2E. */
const TEST_SECRET = /^[123]x0{31}AA$/;

/** Test secrets are only honoured on a local SITE_URL, so a misconfigured deploy fails closed. */
const LOCAL_SITE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

const siteverifySchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

/**
 * Checks a Turnstile token for this request. It must have been solved on our site for this
 * exact action, so a token from the contact button cannot be replayed on the sign-in form
 * (or from another host). Returns a 403 to send back, or null when the token is good.
 */
export async function checkTurnstile(
  { env, ip }: RouteContext,
  token: string,
  action: TurnstileAction,
): Promise<Response | null> {
  const testSecret = TEST_SECRET.test(env.TURNSTILE_SECRET_KEY);
  if (testSecret && !LOCAL_SITE.test(env.SITE_URL)) {
    console.error('TURNSTILE_SECRET_KEY is a Cloudflare test secret but SITE_URL is not local; refusing');
    return errors.forbidden('turnstile_failed');
  }
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  body.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const outcome = res.ok ? siteverifySchema.safeParse(await res.json()) : null;
    if (outcome?.success && outcome.data.success) {
      // Test secrets report a dummy hostname and no action, so only the real secret is held to them.
      if (testSecret) return null;
      const { action: solvedFor, hostname } = outcome.data;
      if (solvedFor === action && hostname === new URL(env.SITE_URL).hostname) return null;
    }
  } catch {
    // An unreachable siteverify fails closed.
  }
  return errors.forbidden('turnstile_failed');
}
