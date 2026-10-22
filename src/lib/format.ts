import { DAY_MS, HOUR_MS, MINUTE_MS, UTC_OFFSET_MS } from '../../shared/api';
import { site } from '../../site.config';
import { intlLocale, t } from './i18n';
import { pad2, zoned } from './zone';

const TIME_ZONE = site.timeZone;

/** Builds a formatter per locale on first use: time-zone formatters are costly to create on slow phones. */
function lazyFormat(options: Intl.DateTimeFormatOptions): (date: Date) => string {
  const formatters: Record<string, Intl.DateTimeFormat> = {};
  return (date) => {
    const locale = intlLocale();
    formatters[locale] ??= new Intl.DateTimeFormat(locale, options);
    return formatters[locale].format(date);
  };
}

const dayFormat = lazyFormat({ timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
// formatTime in worker/lib/alerts.ts repeats this format for alerts; change both together.
const timeFormat = lazyFormat({ timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = lazyFormat({ timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormat = lazyFormat({ timeZone: 'UTC', day: 'numeric', month: 'short' });

/** "Sa. 17 Okt." / "Sat 17 Oct" */
export const formatDay = (iso: string) => dayFormat(new Date(iso));
/** "17 Okt. 2026" / "17 Oct 2026" */
export const formatDate = (iso: string) => dateFormat(new Date(iso));
/** Formats a plain YYYY-MM-DD calendar date as "19 Okt." / "19 Oct". */
export const formatCalendarDay = (ymd: string) => shortDateFormat(new Date(`${ymd}T00:00:00Z`));

const numberFormats: Record<string, Intl.NumberFormat> = {};

/** "12,5": at most one decimal, in the active locale. */
export function formatNumber(n: number): string {
  const locale = intlLocale();
  numberFormats[locale] ??= new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return numberFormats[locale].format(n);
}

/** "12,5 u" / "12,5 h" with one decimal below 100 hours. */
export function formatHours(hours: number): string {
  return `${formatNumber(hours >= 100 ? Math.round(hours) : hours)} ${t().units.h}`;
}
/** "14:05" in the configured zone, from an ISO time or epoch ms. */
export const formatTime = (at: string | number) => timeFormat(new Date(at));

const zoneDay = lazyFormat({ timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "02:30" when the outage ends on the day it began, else "So. 18 Okt. 02:30", so an overnight one reads right. */
export function formatEnd(startIso: string, endIso: string): string {
  const time = formatTime(endIso);
  return zoneDay(new Date(startIso)) === zoneDay(new Date(endIso)) ? time : `${formatDay(endIso)} ${time}`;
}

/** "vandag", "gister" or "op Sa. 17 Okt." (or the English), judged in the configured zone. */
export function formatRelativeDay(iso: string, now: number): string {
  const day = zoneDay(new Date(iso));
  if (day === zoneDay(new Date(now))) return t().day.today;
  if (day === zoneDay(new Date(now - DAY_MS))) return t().day.yesterday;
  return t().day.on(formatDay(iso));
}

/** Whole days, the hours and minutes left over, and the total seconds (negative counts as 0). */
function splitDuration(ms: number) {
  const clamped = Math.max(0, ms);
  return {
    days: Math.floor(clamped / DAY_MS),
    hours: Math.floor((clamped % DAY_MS) / HOUR_MS),
    minutes: Math.floor((clamped % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor(clamped / 1000),
  };
}

/** "3 d 4 u", "2 u 14 min", "2 u", "5 min", "40 s" ("h" in English); a zero remainder is left out. */
export function formatDuration(ms: number): string {
  const { days, hours, minutes, seconds } = splitDuration(ms);
  const u = t().units;
  if (days > 0) return hours > 0 ? `${days} ${u.d} ${hours} ${u.h}` : `${days} ${u.d}`;
  if (hours > 0) return minutes > 0 ? `${hours} ${u.h} ${minutes} ${u.min}` : `${hours} ${u.h}`;
  if (minutes > 0) return `${minutes} ${u.min}`;
  return `${seconds} ${u.s}`;
}

/** Tab-friendly duration: "3d 4u", "1u 5m", "5m" ("h" in English). */
export function formatCompactDuration(ms: number): string {
  const { days, hours, minutes } = splitDuration(ms);
  const u = t().units;
  if (days > 0) return `${days}${u.d} ${hours}${u.h}`;
  if (hours > 0) return `${hours}${u.h} ${minutes}${u.m}`;
  return `${minutes}${u.m}`;
}

/** "01:02:03" stopwatch format. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(totalSeconds / 3600))}:${pad2(Math.floor((totalSeconds % 3600) / 60))}:${pad2(totalSeconds % 60)}`;
}

// The admin's datetime-local inputs are read and written in the configured zone (fixed offset),
// whatever time zone the browser is in.

/** An ISO time or epoch ms as a datetime-local value, "2026-10-17T14:05". */
export const toLocalInput = (at: string | number) =>
  new Date(new Date(at).getTime() + UTC_OFFSET_MS).toISOString().slice(0, 16);

/** A datetime-local value back to ISO 8601 UTC. */
export const fromLocalInput = (value: string) => new Date(zoned(value)).toISOString();
