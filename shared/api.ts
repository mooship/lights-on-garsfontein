// Imported by both the Worker and the browser bundle, so nothing here may depend on either runtime.

import { site } from '../site.config';

// Public responses deliberately never say how an outage was recorded (sensor or by hand);
// only the admin API exposes `source`.

export type PowerStatus = 'ON' | 'OFF';

/** How an outage was recorded: by the heartbeat sensor or by an admin. */
export const OUTAGE_SOURCES = ['sensor', 'manual'] as const;
export type OutageSource = (typeof OUTAGE_SOURCES)[number];

/** All times in the public API are ISO 8601 in UTC; clients convert to the local zone. */
export interface OutageSummary {
  /** Stable for the life of the record; also the CSV `id` and the feed entry's `#outage-<id>`. */
  id: number;
  startTime: string;
  /** Null while the outage is still in progress. */
  endTime: string | null;
  /** Announced in advance, e.g. maintenance or upgrades. */
  planned: boolean;
}

export interface AdminOutage extends OutageSummary {
  source: OutageSource;
  /** Dismissed by an admin: left out of every public view, the status, statistics, CSV and feed. */
  isFalsePositive: boolean;
}

export interface StatusResponse {
  /** OFF while an outage is open or the sensor heartbeat is older than HEARTBEAT_THRESHOLD_MS. */
  status: PowerStatus;
  /** When the current state began: the outage start or last heartbeat when OFF, the latest end in `recent` when ON. */
  since: string | null;
  /** The open outage; null when ON, and briefly when OFF from a stale heartbeat before the cron records it. */
  outage: OutageSummary | null;
  /** The latest outages, newest first, at most RECENT_LIMIT (worker/lib/grid.ts), the open one included. */
  recent: OutageSummary[];
  /**
   * A sensor has reported and its last heartbeat is fresh. When false, ON only means no outage
   * has been reported, not that power was measured.
   */
  monitored: boolean;
  /** Public key for the Turnstile widget on the sign-in form and the privacy page's contact button. */
  turnstileSiteKey: string;
  /** When the Worker built it; an edge-cached copy can lag by STATUS_EDGE_TTL_SECONDS (worker/routes/status.ts). */
  generatedAt: string;
}

export interface AdminOutagesResponse {
  outages: AdminOutage[];
}

/** One window of time. Overlapping outage records count once, and an outage still in progress counts up to now. */
export interface WindowStats {
  /** Hours of the window that fall after tracking began, to one decimal. */
  trackedHours: number;
  /** Hours without power in the window, to one decimal. */
  hoursOff: number;
  /** Outages that overlap the window, including ones that began before it. */
  outages: number;
  /** Share of tracked time with power (0–1, four decimals), or null before any time was tracked. */
  availability: number | null;
  /** The longest outage, in whole minutes, counting only the part inside the window. */
  longestMinutes: number;
  /** South African calendar days the window covers since tracking began. */
  daysTracked: number;
  /** How many of those days had at least one outage. */
  daysWithOutage: number;
  /** Outages in the window that were planned. */
  plannedOutages: number;
}

/** One Monday-to-Sunday week; the current week runs only until now. */
export interface WeekStats {
  /** Monday of the week in South African time, as YYYY-MM-DD. */
  weekStart: string;
  /** As in WindowStats. */
  hoursOff: number;
  /** As in WindowStats. */
  outages: number;
}

export interface StatsResponse {
  /** No statistic counts time before this (TRACKING_SINCE). */
  trackingSince: string;
  /** The 7, 30 and 365 days up to `generatedAt`. */
  last7: WindowStats;
  last30: WindowStats;
  last365: WindowStats;
  /** The 30 days before `last30`, or null until that whole period was tracked. */
  previous30: WindowStats | null;
  /** Up to WEEKS_SHOWN (worker/lib/stats.ts) weeks, oldest first, starting no earlier than the tracking start. */
  weeks: WeekStats[];
  generatedAt: string;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The configured zone's fixed UTC offset; days and weeks start at its local midnight. */
export const UTC_OFFSET_MS = site.utcOffsetMinutes * MINUTE_MS;

/** The calendar date of `ms` in the configured zone, as YYYY-MM-DD. */
export const localDate = (ms: number) => new Date(ms + UTC_OFFSET_MS).toISOString().slice(0, 10);

/** What a Turnstile token was solved for; the server rejects tokens used for anything else. */
export const TURNSTILE_ACTION = { login: 'login', contact: 'contact' } as const;
export type TurnstileAction = (typeof TURNSTILE_ACTION)[keyof typeof TURNSTILE_ACTION];

/** Admin punch clock: punch out when the power goes off, punch in when it comes back. */
export const TIMER_ACTION = { punchOut: 'punch_out', punchIn: 'punch_in' } as const;
export type TimerAction = (typeof TIMER_ACTION)[keyof typeof TIMER_ACTION];

/** What a POST to ADMIN_OUTAGES_PATH (shared/paths.ts) does. */
export const OUTAGE_ACTION = { create: 'create', update: 'update', delete: 'delete' } as const;

/** How long an outage lasted; one still in progress runs until `now`. */
export function outageDurationMs(outage: { startTime: string; endTime: string | null }, now: number): number {
  return (outage.endTime ? Date.parse(outage.endTime) : now) - Date.parse(outage.startTime);
}

/** A sensor heartbeat older than this means the power is off at the measuring point. */
export const HEARTBEAT_THRESHOLD_MS = 3 * MINUTE_MS;

/** Statistics never count time before this. */
export const TRACKING_SINCE = site.trackingSince;

/** The download name of the CSV at CSV_PATH (shared/paths.ts). */
export const CSV_FILE_NAME = `${site.slug}-outages.csv`;
