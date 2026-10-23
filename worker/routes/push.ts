import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DAY_MS, type PushSubscriptionBody } from '../../shared/api';
import { fromBase64Url } from '../../shared/base64url';
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
const PUSH_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
];

function isPushEndpoint(value: string): boolean {
  const url = URL.parse(value);
  if (url?.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  return PUSH_HOSTS.some((host) => (host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host));
}

const base64Url = z
  .string()
  .regex(/^[\w-]+$/)
  .max(256);

/** The decoded bytes, or `null` if `value` is not base64url. */
function decoded(value: string): Uint8Array | null {
  try {
    return fromBase64Url(value);
  } catch {
    // Not base64url at all, which the schema refuses like a key of the wrong size.
    return null;
  }
}

// RFC 8291 needs an uncompressed P-256 point and a 16-byte auth secret. Anything else can never be
// encrypted to, and the push service would never report it gone, so the row would never be deleted.
const P256_POINT_BYTES = 65;
const UNCOMPRESSED_POINT = 0x04;
const AUTH_SECRET_BYTES = 16;
const p256dh = base64Url.refine((value) => {
  const bytes = decoded(value);
  return bytes?.length === P256_POINT_BYTES && bytes[0] === UNCOMPRESSED_POINT;
});
const auth = base64Url.refine((value) => decoded(value)?.length === AUTH_SECRET_BYTES);

const endpoint = z.string().max(2048).refine(isPushEndpoint);

const subscribeSchema = z.object({
  endpoint,
  keys: z.object({ p256dh, auth }),
  locale: z.enum(site.locales),
}) satisfies z.ZodType<PushSubscriptionBody>;

const unsubscribeSchema = z.object({ endpoint });

// The endpoint URL is itself the capability: only its browser and push service know it, so there is
// no ownership check, and whoever holds it may update or delete its row.
async function postSubscription({ request, db }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, subscribeSchema);
  if ('response' in parsed) return parsed.response;
  const { keys, locale } = parsed.data;
  const values = { p256dh: keys.p256dh, auth: keys.auth, locale };
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: parsed.data.endpoint, ...values, createdAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
  return json({ ok: true });
}

async function deleteSubscription({ request, db }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, unsubscribeSchema);
  if ('response' in parsed) return parsed.response;
  // Unknown endpoints get the same answer, so the route does not reveal who is subscribed.
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  return json({ ok: true });
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
