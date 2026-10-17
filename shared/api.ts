// Response shapes shared by the Worker and the SolidJS client.

// Public responses deliberately never say how an outage was recorded (sensor or by hand);
// only the admin API exposes `source`.

export type PowerStatus = 'ON' | 'OFF';
export type OutageSource = 'sensor' | 'manual';

export interface OutageSummary {
  id: number;
  startTime: string;
  endTime: string | null;
  confirmations: number;
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
  turnstileSiteKey: string;
  generatedAt: string;
}

export interface ConfirmResponse {
  confirmations: number;
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

/** Heartbeats older than this mean the grid is off. */
export const HEARTBEAT_THRESHOLD_MS = 180_000;

/** The public start of outage tracking. Statistics never count time before it. */
export const TRACKING_SINCE = '2026-10-17T00:00:00+02:00';
