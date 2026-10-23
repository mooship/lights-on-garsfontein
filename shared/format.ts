// Formatting that reads no signals, so the Worker's alerts and the app's pages word times and
// durations alike; src/lib/format.ts wraps these with the active language.

import { site } from '../site.config';
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from './api';

/** Unit labels, as a dictionary's `units` gives them. */
export interface DurationUnits {
  d: string;
  h: string;
  min: string;
  s: string;
}

const timeFormats = new Map<string, Intl.DateTimeFormat>();

/** "14:05" in the configured zone, from an ISO time or epoch ms; `intlLocale` as in site.intlLocales. */
export function formatTimeOfDay(at: string | number, intlLocale: string): string {
  // Built once per locale: time-zone formatters are costly to create on slow phones.
  let format = timeFormats.get(intlLocale);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale, {
      timeZone: site.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormats.set(intlLocale, format);
  }
  return format.format(new Date(at));
}

/** Whole days, the hours and minutes left over, and the total seconds (negative counts as 0). */
export function splitDuration(ms: number) {
  const clamped = Math.max(0, ms);
  return {
    days: Math.floor(clamped / DAY_MS),
    hours: Math.floor((clamped % DAY_MS) / HOUR_MS),
    minutes: Math.floor((clamped % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor(clamped / SECOND_MS),
  };
}

/**
 * "3 d 4 h", "2 h 14 min", "2 h", "5 min", "40 s"; a zero remainder is left out. Without `days`,
 * a long one counts in hours ("26 h 5 min"); without `seconds`, a short one reads "0 min".
 */
export function formatDurationIn(
  ms: number,
  u: DurationUnits,
  { days: showDays = true, seconds: showSeconds = true } = {},
): string {
  const { days, hours, minutes, seconds } = splitDuration(ms);
  if (showDays && days > 0) return hours > 0 ? `${days} ${u.d} ${hours} ${u.h}` : `${days} ${u.d}`;
  // Here days is 0 unless they are counted as hours.
  const allHours = days * (DAY_MS / HOUR_MS) + hours;
  if (allHours > 0) return minutes > 0 ? `${allHours} ${u.h} ${minutes} ${u.min}` : `${allHours} ${u.h}`;
  if (minutes > 0 || !showSeconds) return `${minutes} ${u.min}`;
  return `${seconds} ${u.s}`;
}
