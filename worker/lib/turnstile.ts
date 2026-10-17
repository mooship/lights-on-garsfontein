const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's public test secrets (1x always passes, 2x fails, 3x "already spent"); used in dev and E2E. */
const TEST_SECRET = /^[123]x0{31}AA$/;

export type TurnstileAction = 'confirm' | 'login';

/**
 * True only for a token solved on our site for this exact action, so a token from the
 * "me too" button cannot be replayed on the sign-in form (or from another host).
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string,
  expected: { action: TurnstileAction; hostname: string },
): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', remoteIp);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const outcome = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    if (outcome.success !== true) return false;
    // Test secrets report a dummy hostname and no action, so only the real secret is held to them.
    if (TEST_SECRET.test(secret)) return true;
    return outcome.action === expected.action && outcome.hostname === expected.hostname;
  } catch {
    return false;
  }
}
