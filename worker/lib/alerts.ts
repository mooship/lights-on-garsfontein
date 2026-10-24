import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { MINUTE_MS, outageDurationMs, SECOND_MS } from '../../shared/api';
import { formatLasted, formatTimeOfDay } from '../../shared/format';
import { localePath } from '../../shared/locale';
import { type Locale, site } from '../../site.config';
import { DICTIONARIES } from '../../src/i18n/index';
import type { Db } from '../db/client';
import { type Outage, outages, pushSubscriptions } from '../db/schema';
import { isPublic } from './grid';

/** `dismissed` follows an `off` for an outage later found to be a false positive, replacing it on screen. */
export type AlertKind = 'off' | 'on' | 'dismissed';

/** What the service worker shows; `tag` is one value so a newer alert replaces the one on screen. */
export interface AlertPayload {
  title: string;
  body: string;
  tag: 'power';
  url: string;
  lang: Locale;
}

const formatTime = (iso: string, locale: Locale) => formatTimeOfDay(iso, site.intlLocales[locale]);

/** The alert for `outage` in the subscriber's language; an `on` alert needs a closed outage. */
export function alertMessage(
  kind: AlertKind,
  outage: Pick<Outage, 'startTime' | 'endTime' | 'isPlanned'>,
  locale: Locale,
): AlertPayload {
  const { push, units } = DICTIONARIES[locale];
  const base = { tag: 'power', url: `${site.url}${localePath(locale)}`, lang: locale } as const;
  if (kind === 'off') {
    const { title, body } = outage.isPlanned ? push.planned : push.off;
    return { ...base, title, body: body(formatTime(outage.startTime, locale)) };
  }
  if (kind === 'dismissed') return { ...base, ...push.dismissed };
  if (!outage.endTime) throw new Error('An on alert needs an outage that has ended');
  const lasted = formatLasted(outageDurationMs(outage, 0), units);
  return { ...base, title: push.on.title, body: push.on.body(formatTime(outage.endTime, locale), lasted) };
}

/**
 * How long an outage lasts before it is worth an alert; one that ends sooner stays silent. It counts
 * from the outage's start, which for a sensor outage is the last heartbeat, so it also covers the
 * time to detect it. Long enough to ride out a router reboot or a longer connection drop.
 */
export const ALERT_DELAY_MS = 10 * MINUTE_MS;
/** Subscriptions per queue message, so one delivery run stays inside a Worker invocation's limits. */
export const PUSH_PAGE_SIZE = 40;
/** How many times one page, or one Telegram message, is tried before it is dropped. */
export const PUSH_MAX_ATTEMPTS = 3;
/** The wait before a retry, multiplied by the attempts so far. */
const ALERT_RETRY_DELAY_SECONDS = MINUTE_MS / SECOND_MS;
/** The most messages Queues accepts in one `sendBatch`. */
const QUEUE_BATCH_LIMIT = 100;

export interface AlertClaim {
  kind: AlertKind;
  outageId: number;
}

/** The queue message body: one page of subscription ids to alert about one outage. */
export interface AlertPage extends AlertClaim {
  ids: number[];
  attempt: number;
  queuedAt: string;
}

/** The queue message body for the owner's Telegram alert about one outage (worker/lib/telegram.ts). */
export interface TelegramAlert extends AlertClaim {
  channel: 'telegram';
  attempt: number;
  queuedAt: string;
}

/** What goes on PUSH_QUEUE; only a Telegram alert has a `channel`. */
export type AlertJob = AlertPage | TelegramAlert;

/** Re-queues `job` for its next attempt, unless it has had PUSH_MAX_ATTEMPTS; returns whether it did. */
export async function retryAlert(queue: Queue<AlertJob>, job: AlertJob): Promise<boolean> {
  if (job.attempt >= PUSH_MAX_ATTEMPTS) return false;
  // A longer wait after each attempt.
  await queue.send({ ...job, attempt: job.attempt + 1 }, { delaySeconds: ALERT_RETRY_DELAY_SECONDS * job.attempt });
  return true;
}

/**
 * Marks the alerts that are due as sent and returns them: off, then on, then dismissed. Each kind
 * is one conditional UPDATE, so two concurrent runs cannot claim the same alert; the three go in
 * one batch to save round trips. A back-on or dismissed alert needs the off alert to have been
 * claimed, so nobody hears a follow-up to an alert they never got. Both follow-ups set
 * `onAlertAt`, so an outage gets one or the other, never both.
 */
export async function claimAlerts(db: Db, now: Date): Promise<AlertClaim[]> {
  const claimedAt = now.toISOString();
  const dueBefore = new Date(now.getTime() - ALERT_DELAY_MS).toISOString();
  const [off, on, dismissed] = await db.batch([
    db
      .update(outages)
      .set({ offAlertAt: claimedAt })
      .where(and(isNull(outages.endTime), isPublic, isNull(outages.offAlertAt), lte(outages.startTime, dueBefore)))
      .returning({ id: outages.id }),
    db
      .update(outages)
      .set({ onAlertAt: claimedAt })
      .where(and(isNotNull(outages.endTime), isPublic, isNotNull(outages.offAlertAt), isNull(outages.onAlertAt)))
      .returning({ id: outages.id }),
    db
      .update(outages)
      .set({ onAlertAt: claimedAt })
      .where(and(eq(outages.isFalsePositive, true), isNotNull(outages.offAlertAt), isNull(outages.onAlertAt)))
      .returning({ id: outages.id }),
  ]);
  return [
    ...off.map(({ id }) => ({ kind: 'off' as const, outageId: id })),
    ...on.map(({ id }) => ({ kind: 'on' as const, outageId: id })),
    ...dismissed.map(({ id }) => ({ kind: 'dismissed' as const, outageId: id })),
  ];
}

/** Clears a claim, if it is still the one made at `claimedAt`, so the next run claims the alert again. */
async function releaseClaim(db: Db, { kind, outageId }: AlertClaim, claimedAt: string): Promise<void> {
  const field = kind === 'off' ? 'offAlertAt' : 'onAlertAt';
  await db
    .update(outages)
    .set({ [field]: null })
    .where(and(eq(outages.id, outageId), eq(outages[field], claimedAt)));
}

/**
 * The outage an alert is about, or `null` if it no longer warrants the alert, which would then mislead.
 * A dismissed alert for an undone dismissal releases its claim, so the outage's real end can still send "back on".
 */
export async function loadDueOutage(db: Db, alert: AlertClaim & { queuedAt: string }): Promise<Outage | null> {
  const outage = await db.select().from(outages).where(eq(outages.id, alert.outageId)).get();
  if (!outage) return null;
  if (alert.kind === 'dismissed') {
    if (outage.isFalsePositive) return outage;
    await releaseClaim(db, alert, alert.queuedAt);
    return null;
  }
  if (outage.isFalsePositive) return null;
  return (outage.endTime !== null) === (alert.kind === 'on') ? outage : null;
}

/**
 * Queues every subscription, in pages, for each claimed alert, and with `telegram` one message to
 * the owner ahead of them. If it fails before any message of a claim is queued, that claim is
 * released and the error rethrown, so the alert is retried rather than lost, and an "on" alert
 * never follows an "off" that nobody got. Once a message is queued the claim stays: some
 * subscribers hearing it beats all of them hearing it twice.
 */
export async function enqueueAlerts(
  db: Db,
  queue: Queue<AlertJob>,
  claims: AlertClaim[],
  now: Date,
  { telegram = false } = {},
): Promise<void> {
  if (claims.length === 0) return;
  const queuedAt = now.toISOString();
  const queued = new Set<AlertClaim>();
  try {
    const rows = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .orderBy(asc(pushSubscriptions.id));
    const ids = rows.map(({ id }) => id);
    const messages: { claim: AlertClaim; request: MessageSendRequest<AlertJob> }[] = [];
    for (const claim of claims) {
      if (telegram) {
        messages.push({ claim, request: { body: { ...claim, channel: 'telegram', attempt: 1, queuedAt } } });
      }
      for (let start = 0; start < ids.length; start += PUSH_PAGE_SIZE) {
        const body = { ...claim, ids: ids.slice(start, start + PUSH_PAGE_SIZE), attempt: 1, queuedAt };
        messages.push({ claim, request: { body } });
      }
    }
    for (let start = 0; start < messages.length; start += QUEUE_BATCH_LIMIT) {
      const slice = messages.slice(start, start + QUEUE_BATCH_LIMIT);
      await queue.sendBatch(slice.map(({ request }) => request));
      for (const { claim } of slice) queued.add(claim);
    }
  } catch (error) {
    for (const claim of claims) if (!queued.has(claim)) await releaseClaim(db, claim, queuedAt);
    throw error;
  }
}
