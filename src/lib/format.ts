import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../shared/api';
import { site } from '../../site.config';
import { intlLocale, t } from './i18n';
import { pad2, zoned } from './zone';

export { outageDurationMs } from '../../shared/api';

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
const timeFormat = lazyFormat({ timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = lazyFormat({ timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormat = lazyFormat({ timeZone: 'UTC', day: 'numeric', month: 'short' });

/** "Sa. 17 Okt." / "Sat, 17 Oct" */
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
/** "14:05" in the configured zone. */
export const formatTime = (iso: string) => timeFormat(new Date(iso));

const zoneDay = lazyFormat({ timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "vandag", "gister" or "op Sa. 17 Okt." (or the English), judged in the configured zone. */
export function formatRelativeDay(iso: string, now: number): string {
  const day = zoneDay(new Date(iso));
  if (day === zoneDay(new Date(now))) return t().day.today;
  if (day === zoneDay(new Date(now - DAY_MS))) return t().day.yesterday;
  return t().day.on(formatDay(iso));
}

/** "No connection · status as at 20:11", with the day when the copy is not from today. */
export function offlineLabel(iso: string, now: number): string {
  const day = formatRelativeDay(iso, now);
  return t().status.offline(formatTime(iso), day === t().day.today ? undefined : day);
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

/** "3 d 4 u", "2 u 14 min", "5 min", "40 s" ("h" in English) */
export function formatDuration(ms: number): string {
  const { days, hours, minutes, seconds } = splitDuration(ms);
  const u = t().units;
  if (days > 0) return `${days} ${u.d} ${hours} ${u.h}`;
  if (hours > 0) return `${hours} ${u.h} ${minutes} ${u.min}`;
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
const OFFSET_MS = site.utcOffsetMinutes * MINUTE_MS;

/** An ISO time as a datetime-local value, "2026-10-17T14:05". */
export const toLocalInput = (iso: string) => new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 16);

/** A datetime-local value back to ISO 8601 UTC. */
export const fromLocalInput = (value: string) => new Date(zoned(value)).toISOString();
