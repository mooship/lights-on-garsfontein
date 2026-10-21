import { isPaused, isStale, type SensorReading, silentSince } from '../../shared/api';

type SensorState =
  | { kind: 'never' }
  | { kind: 'paused'; until: string }
  | { kind: 'reporting'; lastSeen: string }
  /** A pause ended at `since` and no heartbeat has come yet, but the Worker still allows for one. */
  | { kind: 'resuming'; since: string }
  /** `since` is the last heartbeat, or the end of a pause after it, as the Worker counts the silence. */
  | { kind: 'silent'; since: string; forMs: number };

/** What the sensor is doing at `now` (ms), by the same rules as the public status. */
export function sensorState(sensor: SensorReading | null, now: number): SensorState {
  if (!sensor) return { kind: 'never' };
  const { lastSeen, pausedUntil } = sensor;
  if (pausedUntil && isPaused(pausedUntil, now)) return { kind: 'paused', until: pausedUntil };
  if (!isStale(lastSeen, now)) return { kind: 'reporting', lastSeen };
  const since = silentSince(lastSeen, pausedUntil);
  return isStale(since, now) ? { kind: 'silent', since, forMs: now - Date.parse(since) } : { kind: 'resuming', since };
}
