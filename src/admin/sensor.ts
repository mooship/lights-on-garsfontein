import { HEARTBEAT_THRESHOLD_MS, type SensorReading } from '../../shared/api';

export type SensorState =
  | { kind: 'never' }
  | { kind: 'paused'; until: string }
  | { kind: 'reporting'; lastSeen: string }
  /** A pause ended at `since` and no heartbeat has come yet, but the Worker still allows for one. */
  | { kind: 'resuming'; since: string }
  /** `since` is the last heartbeat, or the end of a pause after it, as the Worker counts the silence. */
  | { kind: 'silent'; since: string; forMs: number };

/**
 * What the sensor is doing at `now` (ms). Silence counts as the Worker's `silentSince` and
 * `isStale` (worker/lib/grid.ts) count it, so admin calls it silent only when the Worker would.
 */
export function sensorState(sensor: SensorReading | null, now: number): SensorState {
  if (!sensor) return { kind: 'never' };
  const { lastSeen, pausedUntil } = sensor;
  if (pausedUntil && Date.parse(pausedUntil) > now) return { kind: 'paused', until: pausedUntil };
  if (now - Date.parse(lastSeen) <= HEARTBEAT_THRESHOLD_MS) return { kind: 'reporting', lastSeen };
  const since = pausedUntil && pausedUntil > lastSeen ? pausedUntil : lastSeen;
  const forMs = now - Date.parse(since);
  return forMs <= HEARTBEAT_THRESHOLD_MS ? { kind: 'resuming', since } : { kind: 'silent', since, forMs };
}
