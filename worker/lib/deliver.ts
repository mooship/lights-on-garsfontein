import { inArray } from 'drizzle-orm';
import type { Locale } from '../../site.config';
import { createDb } from '../db/client';
import { type PushSubscriptionRow, pushSubscriptions } from '../db/schema';
import { type AlertPage, type AlertPayload, alertMessage, loadDueOutage, retryAlert } from './alerts';
import { buildPushRequest, PUSH_TTL_SECONDS, vapidSigner } from './webpush';

// Logs name only the push service's host and an error's name: an endpoint path identifies a
// subscriber, and some error messages quote the URL they failed on.
const hostOf = (endpoint: string) => URL.parse(endpoint)?.host ?? 'invalid endpoint';
const errorName = (reason: unknown) => (reason instanceof Error ? reason.name : typeof reason);

/**
 * Sends one page of an alert. Subscriptions the push service reports gone are deleted, and
 * transient failures go back on the queue, with a longer wait each time, until PUSH_MAX_ATTEMPTS.
 */
export async function deliverAlertPage(page: AlertPage, env: Env, now: Date): Promise<void> {
  if (now.getTime() - Date.parse(page.queuedAt) > PUSH_TTL_SECONDS * 1000) return;
  const db = createDb(env.DB);
  const [outage, subscriptions] = await Promise.all([
    loadDueOutage(db, page),
    db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.id, page.ids)),
  ]);
  if (!outage) return;

  // The VAPID token depends only on the push service's origin and `now`, so one per origin serves the page.
  const origins = new Set(subscriptions.flatMap(({ endpoint }) => URL.parse(endpoint)?.origin ?? []));
  let authorizations: Map<string, string>;
  try {
    const sign = await vapidSigner(JSON.parse(env.VAPID_PRIVATE_KEY));
    authorizations = new Map(
      await Promise.all([...origins].map(async (origin) => [origin, await sign(origin, now.getTime())] as const)),
    );
  } catch (error) {
    // Our own fault, which no retry mends, so the page is dropped. The secret itself is never logged.
    console.warn(`Dropped a push page: the VAPID key is unusable (${errorName(error)})`);
    return;
  }

  const payloads = new Map<Locale, AlertPayload>();
  const payloadFor = (locale: Locale) => {
    let payload = payloads.get(locale);
    if (!payload) {
      payload = alertMessage(page.kind, outage, locale);
      payloads.set(locale, payload);
    }
    return payload;
  };

  const send = async (subscription: PushSubscriptionRow): Promise<number> => {
    const authorization = authorizations.get(new URL(subscription.endpoint).origin);
    if (!authorization) throw new TypeError('No VAPID token for this endpoint');
    const request = await buildPushRequest(subscription, payloadFor(subscription.locale), authorization);
    return (await fetch(request)).status;
  };
  const results = await Promise.allSettled(subscriptions.map(send));

  const gone: number[] = [];
  const retry: number[] = [];
  const retryHosts = new Set<string>();
  results.forEach((result, index) => {
    const { id, endpoint } = subscriptions[index] as PushSubscriptionRow;
    const host = hostOf(endpoint);
    // A rejection is retried like a 429 or a 5xx, but it may be ours (a bad row), so it is logged.
    if (result.status === 'rejected') console.warn(`Push to ${host} failed: ${errorName(result.reason)}`);
    const status = result.status === 'fulfilled' ? result.value : null;
    if (status === null || status === 429 || status >= 500) {
      retry.push(id);
      retryHosts.add(host);
    } else if (status === 404 || status === 410) gone.push(id);
    else if (status >= 300) console.warn(`Push service ${host} answered ${status}`);
  });

  // The pushes have gone out, so nothing after them may throw: the queue handler would re-queue the
  // whole page, and everyone who got the alert would get it again.
  try {
    if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  } catch (error) {
    console.warn(`Could not delete ${gone.length} gone push subscriptions: ${errorName(error)}`);
  }
  if (retry.length === 0) return;
  try {
    if (await retryAlert(env.PUSH_QUEUE, { ...page, ids: retry })) return;
    console.warn(
      `Gave up on ${retry.length} push sends after ${page.attempt} attempts to ${[...retryHosts].join(', ')}`,
    );
  } catch (error) {
    console.warn(`Could not re-queue ${retry.length} push sends: ${errorName(error)}`);
  }
}
