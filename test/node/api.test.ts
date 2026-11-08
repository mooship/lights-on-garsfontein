import { describe, expect, it } from 'vitest';
import { MINUTE_MS, outageDurationMs } from '../../shared/api';

describe('outageDurationMs', () => {
  const startTime = '2026-10-22T12:00:00.000Z';
  const start = Date.parse(startTime);

  it('is the time between start and end for an outage that has ended', () => {
    const endTime = '2026-10-22T12:45:00.000Z';

    expect(outageDurationMs({ startTime, endTime }, start + 10 * MINUTE_MS)).toBe(45 * MINUTE_MS);
  });

  it('runs an open outage until now', () => {
    expect(outageDurationMs({ startTime, endTime: null }, start + 10 * MINUTE_MS)).toBe(10 * MINUTE_MS);
  });
});
