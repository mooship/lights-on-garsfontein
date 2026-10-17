import type { TurnstileAction } from '../../shared/api';
import { errors } from './http';
import type { RouteContext } from './router';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's public test secrets (1x always passes, 2x fails, 3x "already spent"); used in dev and E2E. */
const TEST_SECRET = /^[123]x0{31}AA$/;

/**
 * Checks a Turnstile token for this request. It must have been solved on our site for this
 * exact action, so a token from the "me too" button cannot be replayed on the sign-in form
 * (or from another host). Returns a 403 to send back, or null when the token is good.
 */
export async function checkTurnstile(
  { env, ip }: RouteContext,
  token: string,
  action: TurnstileAction,
): Promise<Response | null> {
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  body.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const outcome = res.ok ? ((await res.json()) as { success?: boolean; action?: string; hostname?: string }) : {};
    if (outcome.success === true) {
      // Test secrets report a dummy hostname and no action, so only the real secret is held to them.
      if (TEST_SECRET.test(env.TURNSTILE_SECRET_KEY)) return null;
      if (outcome.action === action && outcome.hostname === new URL(env.SITE_URL).hostname) return null;
    }
  } catch {
    // Treat an unreachable siteverify as a failed check.
  }
  return errors.forbidden('turnstile_failed');
}
