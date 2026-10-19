import { HEARTBEAT_THRESHOLD_MS, type SensorReading } from '../../shared/api';

export type SensorState =
  | { kind: 'never' }
  | { kind: 'paused'; until: string }
  | { kind: 'reporting'; lastSeen: string }
  /** `since` is the last heartbeat, or the end of a pause after it, as the Worker counts the silence. */
  | { kind: 'silent'; since: string; forMs: number };

/** What the sensor is doing at `now` (ms), by the same threshold the Worker uses to open an outage. */
export function sensorState(sensor: SensorReading | null, now: number): SensorState {
  if (!sensor) return { kind: 'never' };
  const { lastSeen, pausedUntil } = sensor;
  if (pausedUntil && Date.parse(pausedUntil) > now) return { kind: 'paused', until: pausedUntil };
  if (now - Date.parse(lastSeen) <= HEARTBEAT_THRESHOLD_MS) return { kind: 'reporting', lastSeen };
  const since = pausedUntil && pausedUntil > lastSeen ? pausedUntil : lastSeen;
  return { kind: 'silent', since, forMs: now - Date.parse(since) };
}
