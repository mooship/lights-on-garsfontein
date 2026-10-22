import { eq, inArray } from 'drizzle-orm';
import type { Locale } from '../../site.config';
import { createDb, type Db } from '../db/client';
import { type Outage, outages, type PushSubscriptionRow, pushSubscriptions } from '../db/schema';
import { type AlertPage, type AlertPayload, alertMessage, PUSH_MAX_ATTEMPTS, releaseClaim } from './alerts';
import { buildPushRequest, PUSH_TTL_SECONDS, vapidSigner } from './webpush';

const RETRY_DELAY_SECONDS = 60;

// Logs name only the push service's host and an error's name: an endpoint path identifies a
// subscriber, and some error messages quote the URL they failed on.
const hostOf = (endpoint: string) => URL.parse(endpoint)?.host ?? 'invalid endpoint';
const errorName = (reason: unknown) => (reason instanceof Error ? reason.name : typeof reason);

/**
 * The outage the page is about, or `null` if it no longer warrants the alert, which would then mislead.
 * A dismissed page for an undone dismissal releases its claim, so the outage's real end can still send "back on".
 */
async function loadDueOutage(db: Db, page: AlertPage): Promise<Outage | null> {
  const outage = await db.select().from(outages).where(eq(outages.id, page.outageId)).get();
  if (!outage) return null;
  if (page.kind === 'dismissed') {
    if (outage.isFalsePositive) return outage;
    await releaseClaim(db, page, page.queuedAt);
    return null;
  }
  if (outage.isFalsePositive) return null;
  return (outage.endTime !== null) === (page.kind === 'on') ? outage : null;
}

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

  if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (retry.length === 0) return;
  if (page.attempt < PUSH_MAX_ATTEMPTS) {
    await env.PUSH_QUEUE.send(
      { ...page, ids: retry, attempt: page.attempt + 1 },
      { delaySeconds: RETRY_DELAY_SECONDS * page.attempt },
    );
  } else {
    console.warn(
      `Gave up on ${retry.length} push sends after ${page.attempt} attempts to ${[...retryHosts].join(', ')}`,
    );
  }
}
