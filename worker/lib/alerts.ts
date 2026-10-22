import { HOUR_MS, MINUTE_MS } from '../../shared/api';
import { localePath } from '../../shared/locale';
import { type Locale, site } from '../../site.config';
import { DICTIONARIES } from '../../src/i18n/index';
import type { Outage } from '../db/schema';

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
