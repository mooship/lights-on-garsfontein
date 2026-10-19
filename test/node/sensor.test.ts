import { describe, expect, it } from 'vitest';
import { HEARTBEAT_THRESHOLD_MS, MINUTE_MS } from '../../shared/api';
import { sensorState } from '../../src/admin/sensor';

const now = Date.parse('2026-10-19T15:00:00.000Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('sensorState', () => {
  it('is never before the first heartbeat', () => {
    expect(sensorState(null, now)).toEqual({ kind: 'never' });
  });

  it('is reporting up to the heartbeat threshold, then silent since the last heartbeat', () => {
    const fresh = ago(HEARTBEAT_THRESHOLD_MS);
    expect(sensorState({ lastSeen: fresh, pausedUntil: null }, now)).toEqual({ kind: 'reporting', lastSeen: fresh });
    const stale = ago(HEARTBEAT_THRESHOLD_MS + 1000);
    expect(sensorState({ lastSeen: stale, pausedUntil: null }, now)).toEqual({
      kind: 'silent',
      since: stale,
      forMs: HEARTBEAT_THRESHOLD_MS + 1000,
    });
  });

  it('is paused until a pause ends, waits the heartbeat threshold, then counts the silence from its end', () => {
    const lastSeen = ago(60 * MINUTE_MS);
    const until = new Date(now + MINUTE_MS).toISOString();
    expect(sensorState({ lastSeen, pausedUntil: until }, now)).toEqual({ kind: 'paused', until });
    const justEnded = ago(HEARTBEAT_THRESHOLD_MS);
    expect(sensorState({ lastSeen, pausedUntil: justEnded }, now)).toEqual({ kind: 'resuming', since: justEnded });
    const ended = ago(10 * MINUTE_MS);
    expect(sensorState({ lastSeen, pausedUntil: ended }, now)).toEqual({
      kind: 'silent',
      since: ended,
      forMs: 10 * MINUTE_MS,
    });
  });
});
