import { DAY_MS as DAY, HOUR_MS as HOUR, MINUTE_MS, type WeekStats, type WindowStats } from '../../shared/api';
import { site } from '../../site.config';

const WEEK = 7 * DAY;
/** Days and weeks are calendar ones in the configured zone (fixed offset). */
const OFFSET = site.utcOffsetMinutes * MINUTE_MS;

interface Interval {
  start: number;
  end: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Turns outage rows into sorted, non-overlapping intervals (open outages run until `now`),
 * so a sensor outage and a manual one covering the same time are counted once.
 */
export function mergeOutages(rows: { startTime: string; endTime: string | null }[], now: number): Interval[] {
  const intervals = rows
    .map((r) => ({ start: Date.parse(r.startTime), end: r.endTime ? Date.parse(r.endTime) : now }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function overlap(i: Interval, from: number, to: number): number {
  return Math.max(0, Math.min(i.end, to) - Math.max(i.start, from));
}

/**
 * Statistics for [from, to), never counting time before `trackingSince`. `intervals` must be
 * sorted and non-overlapping, as `mergeOutages` returns them.
 * `planned` holds the planned outages (already merged) so they can be counted separately.
 */
export function windowStats(
  intervals: Interval[],
  from: number,
  to: number,
  trackingSince: number,
  planned: Interval[] = [],
): WindowStats {
  const start = Math.max(from, trackingSince);
  const tracked = Math.max(0, to - start);
  let offMs = 0;
  let outages = 0;
  let longest = 0;
  for (const i of intervals) {
    const ms = overlap(i, start, to);
    if (ms <= 0) continue;
    offMs += ms;
    outages += 1;
    longest = Math.max(longest, ms);
  }

  // Calendar days (configured zone) touched by the window, and how many of them had any outage. Merged
  // intervals are sorted by both start and end, so one index moves forward with the days.
  let daysTracked = 0;
  let daysWithOutage = 0;
  let next = 0;
  for (let day = dayStartOf(start); day < to; day += DAY) {
    daysTracked += 1;
    const dayFrom = Math.max(day, start);
    const dayTo = Math.min(day + DAY, to);
    while ((intervals[next]?.end ?? Number.POSITIVE_INFINITY) <= dayFrom) next += 1;
    const current = intervals[next];
    if (current && overlap(current, dayFrom, dayTo) > 0) daysWithOutage += 1;
  }

  return {
    trackedHours: round1(tracked / HOUR),
    hoursOff: round1(offMs / HOUR),
    outages,
    availability: tracked > 0 ? Math.round((1 - offMs / tracked) * 10_000) / 10_000 : null,
    longestMinutes: Math.round(longest / MINUTE_MS),
    daysTracked,
    daysWithOutage,
    plannedOutages: planned.filter((i) => overlap(i, start, to) > 0).length,
  };
}

/** Start (UTC ms) of the calendar day containing `ts`, in the configured zone. */
function dayStartOf(ts: number): number {
  return Math.floor((ts + OFFSET) / DAY) * DAY - OFFSET;
}

/** Start (UTC ms) of the Monday-to-Sunday week containing `ts`, in the configured zone. */
export function weekStartOf(ts: number): number {
  const day = Math.floor((ts + OFFSET) / DAY);
  const dayOfWeek = (day + 3) % 7; // 1970-01-01 was a Thursday; Monday = 0.
  return (day - dayOfWeek) * DAY - OFFSET;
}

function localDate(ts: number): string {
  return new Date(ts + OFFSET).toISOString().slice(0, 10);
}

/** Weekly hours off from the tracking start's week to the current week (at most `limit`). */
export function weeklyStats(intervals: Interval[], now: number, trackingSince: number, limit = 26): WeekStats[] {
  if (now < trackingSince) return [];
  const first = Math.max(weekStartOf(trackingSince), weekStartOf(now) - (limit - 1) * WEEK);
  const weeks: WeekStats[] = [];
  for (let start = first; start <= now; start += WEEK) {
    const stats = windowStats(intervals, start, Math.min(start + WEEK, now), trackingSince);
    weeks.push({ weekStart: localDate(start), hoursOff: stats.hoursOff, outages: stats.outages });
  }
  return weeks;
}
