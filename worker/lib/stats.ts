import type { WeekStats, WindowStats } from '../../shared/api';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** South Africa has no daylight saving: SAST is always UTC+2. */
const SAST_OFFSET = 2 * HOUR;

export interface Interval {
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

/** Statistics for [from, to), never counting time before `trackingSince`. */
export function windowStats(intervals: Interval[], from: number, to: number, trackingSince: number): WindowStats {
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
  return {
    trackedHours: round1(tracked / HOUR),
    hoursOff: round1(offMs / HOUR),
    outages,
    availability: tracked > 0 ? Math.round((1 - offMs / tracked) * 10_000) / 10_000 : null,
    longestMinutes: Math.round(longest / 60_000),
  };
}

/** Start (UTC ms) of the SAST Monday-to-Sunday week containing `ts`. */
export function weekStartOf(ts: number): number {
  const day = Math.floor((ts + SAST_OFFSET) / DAY);
  const dayOfWeek = (day + 3) % 7; // 1970-01-01 was a Thursday; Monday = 0.
  return (day - dayOfWeek) * DAY - SAST_OFFSET;
}

function sastDate(ts: number): string {
  return new Date(ts + SAST_OFFSET).toISOString().slice(0, 10);
}

/** Weekly hours off from the tracking start's week to the current week (at most `limit`). */
export function weeklyStats(intervals: Interval[], now: number, trackingSince: number, limit = 26): WeekStats[] {
  if (now < trackingSince) return [];
  const first = Math.max(weekStartOf(trackingSince), weekStartOf(now) - (limit - 1) * WEEK);
  const weeks: WeekStats[] = [];
  for (let start = first; start <= now; start += WEEK) {
    const stats = windowStats(intervals, start, Math.min(start + WEEK, now), trackingSince);
    weeks.push({ weekStart: sastDate(start), hoursOff: stats.hoursOff, outages: stats.outages });
  }
  return weeks;
}

export const DAY_MS = DAY;
