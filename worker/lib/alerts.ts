import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { HOUR_MS, MINUTE_MS } from '../../shared/api';
import { localePath } from '../../shared/locale';
import { type Locale, site } from '../../site.config';
import { DICTIONARIES } from '../../src/i18n/index';
import type { Db } from '../db/client';
import { type Outage, outages, pushSubscriptions } from '../db/schema';

export const ALERT_KINDS = ['off', 'on'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** What the service worker shows; `tag` is one value so a newer alert replaces the one on screen. */
export interface AlertPayload {
  title: string;
  body: string;
  tag: 'power';
  url: string;
  lang: Locale;
}

// The Worker cannot import src/lib/format.ts (it reads Solid signals), so this repeats its time format.
const timeFormats: Partial<Record<Locale, Intl.DateTimeFormat>> = {};
function formatTime(iso: string, locale: Locale): string {
  timeFormats[locale] ??= new Intl.DateTimeFormat(site.intlLocales[locale], {
    timeZone: site.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return timeFormats[locale].format(new Date(iso));
}

/** "2 h 13 min", "2 h" or "7 min": an alert needs no seconds or days. */
function formatLasted(ms: number, locale: Locale): string {
  const { h, min } = DICTIONARIES[locale].units;
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (hours === 0) return `${minutes} ${min}`;
  return minutes === 0 ? `${hours} ${h}` : `${hours} ${h} ${minutes} ${min}`;
}

/** The alert for `outage` in the subscriber's language; an `on` alert needs a closed outage. */
export function alertMessage(
  kind: AlertKind,
  outage: Pick<Outage, 'startTime' | 'endTime' | 'isPlanned'>,
  locale: Locale,
): AlertPayload {
  const { push } = DICTIONARIES[locale];
  const base = { tag: 'power', url: `${site.url}${localePath(locale)}`, lang: locale } as const;
  if (kind === 'off') {
    const { title, body } = outage.isPlanned ? push.planned : push.off;
    return { ...base, title, body: body(formatTime(outage.startTime, locale)) };
  }
  if (!outage.endTime) throw new Error('An on alert needs an outage that has ended');
  const lasted = Date.parse(outage.endTime) - Date.parse(outage.startTime);
  return {
    ...base,
    title: push.on.title,
    body: push.on.body(formatTime(outage.endTime, locale), formatLasted(lasted, locale)),
  };
}

/** How long an outage lasts before it is worth an alert; one that ends sooner stays silent. */
export const ALERT_DELAY_MS = 5 * MINUTE_MS;
/** Subscriptions per queue message, so one delivery run stays inside a Worker invocation's limits. */
export const PUSH_PAGE_SIZE = 40;
/** How many times one page is tried before it is dropped. */
export const PUSH_MAX_ATTEMPTS = 3;
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

/**
 * Marks the alerts that are due as sent and returns them, off before on. Each claim is one
 * conditional UPDATE, so two concurrent runs cannot claim the same alert. A back-on alert needs
 * the off alert to have been claimed, so nobody hears "power is back" without hearing it went off.
 */
export async function claimAlerts(db: Db, now: Date): Promise<AlertClaim[]> {
  const claimedAt = now.toISOString();
  const dueBefore = new Date(now.getTime() - ALERT_DELAY_MS).toISOString();
  const off = await db
    .update(outages)
    .set({ offAlertAt: claimedAt })
    .where(
      and(
        isNull(outages.endTime),
        eq(outages.isFalsePositive, false),
        isNull(outages.offAlertAt),
        lte(outages.startTime, dueBefore),
      ),
    )
    .returning({ id: outages.id });
  const on = await db
    .update(outages)
    .set({ onAlertAt: claimedAt })
    .where(
      and(
        isNotNull(outages.endTime),
        eq(outages.isFalsePositive, false),
        isNotNull(outages.offAlertAt),
        isNull(outages.onAlertAt),
      ),
    )
    .returning({ id: outages.id });
  return [
    ...off.map(({ id }) => ({ kind: 'off' as const, outageId: id })),
    ...on.map(({ id }) => ({ kind: 'on' as const, outageId: id })),
  ];
}

/** Clears a claim, if it is still the one made at `claimedAt`, so the next run claims the alert again. */
async function releaseClaim(db: Db, { kind, outageId }: AlertClaim, claimedAt: string): Promise<void> {
  const column = kind === 'off' ? outages.offAlertAt : outages.onAlertAt;
  await db
    .update(outages)
    .set(kind === 'off' ? { offAlertAt: null } : { onAlertAt: null })
    .where(and(eq(outages.id, outageId), eq(column, claimedAt)));
}

/**
 * Queues every subscription, in pages, for each claimed alert. If it fails before any page of a
 * claim is queued, that claim is released and the error rethrown, so the alert is retried rather
 * than lost, and an "on" alert never follows an "off" that nobody got. Once a page is queued the
 * claim stays: some subscribers hearing it beats all of them hearing it twice.
 */
export async function enqueueAlerts(db: Db, queue: Queue<AlertPage>, claims: AlertClaim[], now: Date): Promise<void> {
  if (claims.length === 0) return;
  const queuedAt = now.toISOString();
  const queued = new Set<AlertClaim>();
  try {
    const rows = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .orderBy(asc(pushSubscriptions.id));
    const ids = rows.map(({ id }) => id);
    const messages: { claim: AlertClaim; request: MessageSendRequest<AlertPage> }[] = [];
    for (const claim of claims) {
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
