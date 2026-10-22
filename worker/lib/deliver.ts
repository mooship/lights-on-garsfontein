import { eq, inArray } from 'drizzle-orm';
import { createDb, type Db } from '../db/client';
import { type Outage, outages, type PushSubscriptionRow, pushSubscriptions } from '../db/schema';
import { type AlertPage, alertMessage, PUSH_MAX_ATTEMPTS, releaseClaim } from './alerts';
import { buildPushRequest, PUSH_TTL_SECONDS, type VapidSigner, vapidSigner } from './webpush';

const RETRY_DELAY_SECONDS = 60;

/** The push service's host; an endpoint path identifies a subscriber, so logs name only this. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    // A row that was never a valid URL must not stop the rest of the page from being logged.
    return 'invalid endpoint';
  }
}

/** A rejection as one log line; the message is scrubbed because some errors quote the URL they failed on. */
function describeRejection(reason: unknown, endpoint: string): string {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  return `${error.name}: ${error.message.replaceAll(endpoint, '<endpoint>')}`;
}

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
  const outage = await loadDueOutage(db, page);
  if (!outage) return;
  const subscriptions = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.id, page.ids));
  const privateJwk: JsonWebKey = JSON.parse(env.VAPID_PRIVATE_KEY);

  // The VAPID token depends only on the push service's origin and `now`, so one per origin serves the page.
  // Built lazily inside each send, so a bad key fails, and is logged, per send like any other failure.
  let signer: Promise<VapidSigner> | undefined;
  const authorizations = new Map<string, Promise<string>>();
  const authorizationFor = (endpoint: string): Promise<string> => {
    const origin = new URL(endpoint).origin;
    let authorization = authorizations.get(origin);
    if (!authorization) {
      signer ??= vapidSigner(privateJwk);
      authorization = signer.then((sign) => sign(endpoint, now.getTime()));
      authorizations.set(origin, authorization);
    }
    return authorization;
  };

  const send = async (subscription: PushSubscriptionRow): Promise<number> => {
    const payload = alertMessage(page.kind, outage, subscription.locale);
    const authorization = await authorizationFor(subscription.endpoint);
    const request = await buildPushRequest(subscription, payload, privateJwk, now.getTime(), authorization);
    return (await fetch(request)).status;
  };
  const results = await Promise.allSettled(subscriptions.map(send));

  const gone: number[] = [];
  const retry: number[] = [];
  const retryHosts = new Set<string>();
  results.forEach((result, index) => {
    const { id, endpoint } = subscriptions[index] as PushSubscriptionRow;
    const host = hostOf(endpoint);
    // A rejection is retried like a 429 or a 5xx, but it may be ours (a bad key or row), so it is logged.
    if (result.status === 'rejected') {
      console.warn(`Push to ${host} failed: ${describeRejection(result.reason, endpoint)}`);
    }
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
