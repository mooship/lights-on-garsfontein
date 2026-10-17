// Response shapes shared by the Worker and the SolidJS client.

import { site } from '../site.config';

// Public responses deliberately never say how an outage was recorded (sensor or by hand);
// only the admin API exposes `source`.

export type PowerStatus = 'ON' | 'OFF';
export type OutageSource = 'sensor' | 'manual';

export interface OutageSummary {
  id: number;
  startTime: string;
  endTime: string | null;
  confirmations: number;
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
  /** "Still off where you are?" reports in the last STILL_OFF_WINDOW_MS; always 0 while OFF. */
  stillOffReports: number;
  turnstileSiteKey: string;
  generatedAt: string;
}

export interface ConfirmRequest {
  /** Turnstile token solved for the 'confirm' action. */
  token: string;
  /** The outage the visitor is confirming; if another one is open now, the server answers 409 `outage_changed`. */
  outageId?: number;
}

export interface ConfirmResponse {
  confirmations: number;
}

export interface StillOffRequest {
  /** Turnstile token solved for the 'still_off' action. */
  token: string;
}

export interface StillOffResponse {
  /** Reports in the last STILL_OFF_WINDOW_MS, this one included. */
  reports: number;
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
export type TurnstileAction = 'confirm' | 'login' | 'still_off' | 'contact';

/** How far back "still off" reports are counted. */
export const STILL_OFF_WINDOW_MS = HOUR_MS;

/** One "still off" report per client per this long. */
export const STILL_OFF_DEDUPE_MS = 2 * HOUR_MS;

/** Admin punch clock: punch out when the power goes off, punch in when it comes back. */
export type TimerAction = 'punch_out' | 'punch_in';

/** How long an outage lasted; one still in progress runs until `now`. */
export function outageDurationMs(outage: { startTime: string; endTime: string | null }, now: number): number {
  return (outage.endTime ? Date.parse(outage.endTime) : now) - Date.parse(outage.startTime);
}

/** Heartbeats older than this mean the grid is off. */
export const HEARTBEAT_THRESHOLD_MS = 180_000;

/** The public start of outage tracking (site.config.ts). Statistics never count time before it. */
export const TRACKING_SINCE = site.trackingSince;
