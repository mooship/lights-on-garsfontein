import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../shared/api';
import { intlLocale, t } from './i18n';

export { outageDurationMs } from '../../shared/api';

const TIME_ZONE = 'Africa/Johannesburg';

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
export const formatTime = (iso: string) => timeFormat(new Date(iso));

const sastDay = lazyFormat({ timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "vandag", "gister" or "op Sa. 17 Okt." (or the English), judged in South African time. */
export function formatRelativeDay(iso: string, now: number): string {
  const day = sastDay(new Date(iso));
  if (day === sastDay(new Date(now))) return t().day.today;
  if (day === sastDay(new Date(now - DAY_MS))) return t().day.yesterday;
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

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "01:02:03" stopwatch format. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(totalSeconds / 3600))}:${pad2(Math.floor((totalSeconds % 3600) / 60))}:${pad2(totalSeconds % 60)}`;
}

// South Africa is UTC+2 all year (no daylight saving), so the admin's datetime-local inputs are
// read and written as SAST whatever time zone the browser is in.
const SAST_OFFSET_MS = 2 * HOUR_MS;

/** Converts an ISO string to the value a datetime-local input expects, in SAST. */
export const toLocalInput = (iso: string) => new Date(Date.parse(iso) + SAST_OFFSET_MS).toISOString().slice(0, 16);

/** Reads a datetime-local value as SAST and returns it as an ISO string. */
export const fromLocalInput = (value: string) => new Date(`${value}+02:00`).toISOString();
