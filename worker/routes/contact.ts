import { z } from 'zod';
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
  if (!email) return json({ error: 'not_configured' }, 404);
  const refused = await checkTurnstile(ctx, parsed.data.token, 'contact');
  if (refused) return refused;
  return json({ email });
}

export const contactRoutes: Routes = {
  'POST /api/contact': { handler: postContact, sameOrigin: true, limiter: 'CONFIRM_LIMITER' },
};
