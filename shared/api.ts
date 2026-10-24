// Imported by both the Worker and the browser bundle, so nothing here may depend on either runtime.

import { type Locale, site } from '../site.config';

// Public responses deliberately never say how an outage was recorded (sensor or by hand);
// only the admin API exposes `source`.

export const POWER_STATUSES = ['ON', 'OFF'] as const;
export type PowerStatus = (typeof POWER_STATUSES)[number];

/** ON, OFF, or NONE: ON without a live reading only means no outage was reported, so it never claims ON. */
export const BADGE_STATES = [...POWER_STATUSES, 'NONE'] as const;
export type BadgeState = (typeof BADGE_STATES)[number];

export const badgeState = (status: PowerStatus, monitored: boolean): BadgeState =>
  status === 'ON' && !monitored ? 'NONE' : status;

/** How an outage was recorded: by the heartbeat sensor or by an admin. */
export const OUTAGE_SOURCES = ['sensor', 'manual'] as const;
export type OutageSource = (typeof OUTAGE_SOURCES)[number];

/** Who marked an outage as a false positive: the sensor, reporting it had power throughout, or the admin. */
export const DISMISSED_BY = ['sensor', 'admin'] as const;
type DismissedBy = (typeof DISMISSED_BY)[number];

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
  /** Who marked it as a false positive; null when it is not one, or when that was not recorded. */
  dismissedBy: DismissedBy | null;
}

export interface StatusResponse {
  /** OFF while an outage is open or the sensor heartbeat is older than HEARTBEAT_THRESHOLD_MS. */
  status: PowerStatus;
  /** When the current state began: the outage start or the sensor's silence when OFF, the latest end in `recent` when ON. */
  since: string | null;
  /** The open outage; null when ON, and briefly when OFF from a stale heartbeat before the cron records it. */
  outage: OutageSummary | null;
  /** The latest outages, newest first, at most RECENT_LIMIT, the open one included. */
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

/** How many outages StatusResponse.recent holds; the page offers the rest from OUTAGES_PATH (shared/paths.ts). */
export const RECENT_LIMIT = 5;

export interface OutagesResponse {
  /** Every outage but false positives, newest first. */
  outages: OutageSummary[];
  generatedAt: string;
}

/** The sensor's last heartbeat and pause, as stored; admin works out its state from these. */
export interface SensorReading {
  lastSeen: string;
  /** Null when the sensor has never been paused; a past time when a pause has ended. */
  pausedUntil: string | null;
}

export interface AdminOutagesResponse {
  outages: AdminOutage[];
  /** Null until the sensor's first heartbeat. */
  sensor: SensorReading | null;
}

/** One window of time. Overlapping outage records count once, and an outage still in progress counts up to now. */
export interface WindowStats {
  /** Hours of the window that fall after tracking began, to one decimal. */
  trackedHours: number;
  /** Hours without power in the window, to one decimal. */
  hoursOff: number;
  /** The time without power in the window, in whole minutes, as precise as `longestMinutes`. */
  minutesOff: number;
  /** Outages that overlap the window, including ones that began before it. */
  outages: number;
  /** Share of tracked time with power (0–1, four decimals), or null before any time was tracked. */
  availability: number | null;
  /** The longest outage, in whole minutes, counting only the part inside the window. */
  longestMinutes: number;
  /** The median outage, in whole minutes and counted like `longestMinutes`; null without outages. */
  medianMinutes: number | null;
  /** Calendar days in the configured zone that the window covers since tracking began. */
  daysTracked: number;
  /** How many of those days had at least one outage. */
  daysWithOutage: number;
  plannedOutages: number;
  /** Share of the window with a live reading (0–1, rounded down to four decimals); null when it starts before COVERAGE_SINCE. */
  coverage: number | null;
}

/** One Monday-to-Sunday week, its figures as in WindowStats; the current week runs only until now. */
export type WeekStats = Pick<WindowStats, 'hoursOff' | 'minutesOff' | 'outages'> & {
  /** Monday of the week in the configured zone, as YYYY-MM-DD. */
  weekStart: string;
};

export interface StatsResponse {
  /** No statistic counts time before this (TRACKING_SINCE). */
  trackingSince: string;
  /** Windows starting before this have no coverage (COVERAGE_SINCE). */
  coverageSince: string;
  /** The 7, 30 and 365 days up to `generatedAt`. */
  last7: WindowStats;
  last30: WindowStats;
  last365: WindowStats;
  /** The 30 days before `last30`, or null until that whole period was tracked. */
  previous30: WindowStats | null;
  /** Up to WEEKS_SHOWN (worker/lib/stats.ts) weeks, oldest first, starting no earlier than the tracking start. */
  weeks: WeekStats[];
  /** Minutes without power in each local clock hour over `last30`'s window: 24 entries, index 0 is 00:00 to 01:00. */
  last30ByHour: number[];
  generatedAt: string;
}

/** A browser's push subscription, as the app sends it to PUSH_SUBSCRIPTION_PATH (shared/paths.ts). */
export interface PushSubscriptionBody {
  endpoint: string;
  keys: {
    /** Base64url, the subscription's receiver public key. */
    p256dh: string;
    /** Base64url, the subscription's auth secret. */
    auth: string;
  };
  /** The language the alerts are written in. */
  locale: Locale;
}

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The configured zone's fixed UTC offset; days and weeks start at its local midnight. */
export const UTC_OFFSET_MS = site.utcOffsetMinutes * MINUTE_MS;

/** The calendar date of `ms` in the configured zone, as YYYY-MM-DD. */
export const localDate = (ms: number) => new Date(ms + UTC_OFFSET_MS).toISOString().slice(0, 10);

/** The longest sign-in username and password the server accepts; the form caps its fields to match. */
export const CREDENTIAL_MAX_LENGTH = { username: 128, password: 256 } as const;

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
// trends.how in src/i18n states it in minutes; change them together.
export const HEARTBEAT_THRESHOLD_MS = 3 * MINUTE_MS;

// The Worker decides the public status with these and admin shows the sensor's state with them, so
// both call a sensor silent at the same moment. worker/lib/grid.ts repeats silentSince in SQL.

/** Whether a heartbeat (or the end of a pause) at `at` is too old at `now` (ms) to count as a live reading. */
export const isStale = (at: string, now: number) => now - Date.parse(at) > HEARTBEAT_THRESHOLD_MS;

/** Whether the sensor is paused at `now` (ms). */
export const isPaused = (pausedUntil: string | null, now: number) =>
  pausedUntil !== null && Date.parse(pausedUntil) > now;

/** When the sensor's current silence began: its last heartbeat, or the end of a pause after it. */
export const silentSince = (lastSeen: string, pausedUntil: string | null) =>
  pausedUntil !== null && pausedUntil > lastSeen ? pausedUntil : lastSeen;

/** Statistics never count time before this. */
export const TRACKING_SINCE = site.trackingSince;

/** Reading coverage is known only for windows starting from this. */
export const COVERAGE_SINCE = site.coverageSince;

/** The download name of the CSV at CSV_PATH (shared/paths.ts). */
export const CSV_FILE_NAME = `${site.slug}-outages.csv`;
