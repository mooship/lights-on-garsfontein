// Imported by both the Worker and the browser bundle, so nothing here may depend on either runtime.

import { site } from '../site.config';

// Public responses deliberately never say how an outage was recorded (sensor or by hand);
// only the admin API exposes `source`.

export type PowerStatus = 'ON' | 'OFF';
export type OutageSource = 'sensor' | 'manual';

export interface OutageSummary {
  id: number;
  startTime: string;
  endTime: string | null;
  /** Announced in advance, e.g. maintenance or upgrades. */
  planned: boolean;
}

export interface AdminOutage extends OutageSummary {
  source: OutageSource;
  isFalsePositive: boolean;
}

export interface StatusResponse {
  status: PowerStatus;
  /** When the current state began, if known. */
  since: string | null;
  outage: OutageSummary | null;
  recent: OutageSummary[];
  /**
   * A sensor has reported and its last heartbeat is fresh. When false, ON only means no outage
   * has been reported, not that power was measured.
   */
  monitored: boolean;
  turnstileSiteKey: string;
  generatedAt: string;
}

export interface AdminOutagesResponse {
  outages: AdminOutage[];
}

export interface WindowStats {
  /** Hours of the window that fall after tracking began. */
  trackedHours: number;
  hoursOff: number;
  outages: number;
  /** Share of tracked time with power (0–1), or null before any time was tracked. */
  availability: number | null;
  longestMinutes: number;
  /** South African calendar days the window covers since tracking began. */
  daysTracked: number;
  /** How many of those days had at least one outage. */
  daysWithOutage: number;
  /** Outages in the window that were planned. */
  plannedOutages: number;
}

export interface WeekStats {
  /** Monday of the week in South African time, as YYYY-MM-DD. */
  weekStart: string;
  hoursOff: number;
  outages: number;
}

export interface StatsResponse {
  trackingSince: string;
  last7: WindowStats;
  last30: WindowStats;
  last365: WindowStats;
  /** The 30 days before `last30`, or null until that whole period was tracked. */
  previous30: WindowStats | null;
  /** Up to 26 weeks, oldest first, starting no earlier than the tracking start. */
  weeks: WeekStats[];
  generatedAt: string;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

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

/** Heartbeats older than this mean the grid is off. */
export const HEARTBEAT_THRESHOLD_MS = 180_000;

/** Statistics never count time before this. */
export const TRACKING_SINCE = site.trackingSince;

/** The download name of the CSV at CSV_PATH (shared/paths.ts). */
export const CSV_FILE_NAME = `${site.slug}-outages.csv`;
