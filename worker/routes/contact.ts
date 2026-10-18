import { z } from 'zod';
import { TURNSTILE_ACTION } from '../../shared/api';
import { ERROR } from '../../shared/errors';
import { CONTACT_PATH } from '../../shared/paths';
import { json, parseBody } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { checkTurnstile } from '../lib/turnstile';

const contactSchema = z.object({ token: z.string().min(1).max(2048) });

/**
 * The operator's email address, for the privacy page's "Show email address" button. It lives
 * only in the CONTACT_EMAIL secret, never in the repo, the HTML or the bundle, and is handed out
 * only for a Turnstile token solved for `contact`, so scrapers cannot harvest it.
 */
async function postContact(ctx: RouteContext): Promise<Response> {
  const { request, env } = ctx;
  const parsed = await parseBody(request, contactSchema);
  if ('response' in parsed) return parsed.response;
  // Checked before Turnstile, so an unconfigured deploy spends no siteverify call.
  const email = env.CONTACT_EMAIL?.trim();
  if (!email) return json({ error: ERROR.notConfigured }, 404);
  const refused = await checkTurnstile(ctx, parsed.data.token, TURNSTILE_ACTION.contact);
  if (refused) return refused;
  return json({ email });
}

export const contactRoutes: Routes = {
  [`POST ${CONTACT_PATH}`]: { handler: postContact, sameOrigin: true, limiter: 'CONFIRM_LIMITER' },
};
