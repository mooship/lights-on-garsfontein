import { eq, inArray } from 'drizzle-orm';
import { createDb, type Db } from '../db/client';
import { type Outage, outages, type PushSubscriptionRow, pushSubscriptions } from '../db/schema';
import { type AlertPage, alertMessage, PUSH_MAX_ATTEMPTS } from './alerts';
import { buildPushRequest, PUSH_TTL_SECONDS } from './webpush';

const RETRY_DELAY_SECONDS = 60;

/** The outage the page is about, or `null` if it no longer warrants the alert, which would then mislead. */
async function loadDueOutage(db: Db, page: AlertPage): Promise<Outage | null> {
  const outage = await db.select().from(outages).where(eq(outages.id, page.outageId)).get();
  if (!outage || outage.isFalsePositive) return null;
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

  const send = async (subscription: PushSubscriptionRow): Promise<number> => {
    const payload = alertMessage(page.kind, outage, subscription.locale);
    const request = await buildPushRequest(subscription, payload, privateJwk, now.getTime());
    return (await fetch(request)).status;
  };
  const results = await Promise.allSettled(subscriptions.map(send));

  const gone: number[] = [];
  const retry: number[] = [];
  results.forEach((result, index) => {
    const { id, endpoint } = subscriptions[index] as PushSubscriptionRow;
    // A rejected request (network error) is as transient as a 429 or a 5xx.
    const status = result.status === 'fulfilled' ? result.value : null;
    if (status === null || status === 429 || status >= 500) retry.push(id);
    else if (status === 404 || status === 410) gone.push(id);
    else if (status >= 300) console.warn(`Push service ${new URL(endpoint).host} answered ${status}`);
  });

  if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (retry.length > 0 && page.attempt < PUSH_MAX_ATTEMPTS) {
    await env.PUSH_QUEUE.send(
      { ...page, ids: retry, attempt: page.attempt + 1 },
      { delaySeconds: RETRY_DELAY_SECONDS * page.attempt },
    );
  }
}
