import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DAY_MS } from '../../shared/api';
import { ERROR } from '../../shared/errors';
import { PUSH_KEY_PATH, PUSH_SUBSCRIPTION_PATH } from '../../shared/paths';
import { site } from '../../site.config';
import { pushSubscriptions } from '../db/schema';
import { errors, json, parseBody, publicCache } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { vapidPublicKey } from '../lib/webpush';

/**
 * The push services browsers use. The Worker later POSTs to whatever endpoint is stored, so an
 * endpoint off this list is refused: it would make the Worker send requests to any address.
 * An entry starting with a dot matches every subdomain; the others match one host.
 */
export const PUSH_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'web.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

export function isPushEndpoint(value: string): boolean {
  const url = URL.parse(value);
  if (url?.protocol !== 'https:' || url.port !== '') return false;
  return PUSH_HOSTS.some((host) => (host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host));
}

const base64Url = z
  .string()
  .regex(/^[\w-]+$/)
  .max(256);

const endpoint = z.string().max(2048).refine(isPushEndpoint);

const subscribeSchema = z.object({
  endpoint,
  keys: z.object({ p256dh: base64Url, auth: base64Url }),
  locale: z.enum(site.locales),
});

const unsubscribeSchema = z.object({ endpoint });

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

async function postSubscription({ request, db }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, subscribeSchema);
  if ('response' in parsed) return parsed.response;
  const { keys, locale } = parsed.data;
  const values = { p256dh: keys.p256dh, auth: keys.auth, locale };
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: parsed.data.endpoint, ...values, createdAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
  return noContent();
}

async function deleteSubscription({ request, db }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, unsubscribeSchema);
  if ('response' in parsed) return parsed.response;
  // Unknown endpoints get the same answer, so the route does not reveal who is subscribed.
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  return noContent();
}

function getKey({ env }: RouteContext): Response {
  let publicKey: string;
  try {
    publicKey = vapidPublicKey(JSON.parse(env.VAPID_PRIVATE_KEY));
  } catch {
    // An unset or unusable secret, which must never reach a browser as a key.
    return errors.notFound(ERROR.notConfigured);
  }
  return json({ publicKey }, 200, { 'Cache-Control': publicCache(DAY_MS) });
}

export const pushRoutes: Routes = {
  [`GET ${PUSH_KEY_PATH}`]: { handler: getKey, limiter: 'STATUS_LIMITER' },
  [`POST ${PUSH_SUBSCRIPTION_PATH}`]: { handler: postSubscription, limiter: 'PUSH_LIMITER' },
  [`DELETE ${PUSH_SUBSCRIPTION_PATH}`]: { handler: deleteSubscription, limiter: 'PUSH_LIMITER' },
};
