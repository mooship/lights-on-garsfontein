import { beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../shared/api';
import {
  formatCalendarDay,
  formatCompactDuration,
  formatDate,
  formatDuration,
  formatEnd,
  formatRelativeDay,
  fromLocalInput,
  toLocalInput,
} from '../../src/lib/format';
import { switchLocale } from '../../src/lib/i18n';
import { zoned } from '../../src/lib/zone';

const at = (wall: string) => Date.parse(zoned(wall));

beforeEach(() => switchLocale('en'));

describe('admin time inputs', () => {
  it('show and read times in the configured zone, whatever zone the browser is in', () => {
    expect(toLocalInput('2026-10-17T22:15:00.000Z')).toBe('2026-10-18T00:15');
    expect(fromLocalInput('2026-10-18T00:15')).toBe('2026-10-17T22:15:00.000Z');
  });

  it('round-trip to the minute', () => {
    for (const iso of ['2026-10-17T21:59:00.000Z', '2026-12-31T22:00:00.000Z', '2026-03-01T00:00:00.000Z']) {
      expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    }
    expect(fromLocalInput(toLocalInput('2026-10-17T10:00:59.999Z'))).toBe('2026-10-17T10:00:00.000Z');
  });
});

describe('durations', () => {
  it('switch unit at a minute, an hour and a day', () => {
    const cases: [ms: number, full: string, compact: string][] = [
      [-5_000, '0 s', '0m'],
      [59_999, '59 s', '0m'],
      [MINUTE_MS, '1 min', '1m'],
      [HOUR_MS - 1, '59 min', '59m'],
      [HOUR_MS, '1 h', '1h 0m'],
      [DAY_MS - 1, '23 h 59 min', '23h 59m'],
      [DAY_MS, '1 d', '1d 0h'],
      [3 * DAY_MS + 4 * HOUR_MS + 59 * MINUTE_MS, '3 d 4 h', '3d 4h'],
    ];
    for (const [ms, full, compact] of cases) {
      expect(formatDuration(ms), String(ms)).toBe(full);
      expect(formatCompactDuration(ms), String(ms)).toBe(compact);
    }
  });

  it('leave out a zero remainder', () => {
    expect(formatDuration(2 * HOUR_MS + 30_000)).toBe('2 h');
    expect(formatDuration(3 * DAY_MS + 59 * MINUTE_MS)).toBe('3 d');
  });

  it('use the active language’s units', () => {
    switchLocale('af');
    expect(formatDuration(HOUR_MS + MINUTE_MS)).toBe('1 u 1 min');
    expect(formatCompactDuration(HOUR_MS + MINUTE_MS)).toBe('1u 1m');
  });
});

describe('formatEnd', () => {
  it('gives the end time alone on the start day, and with its day after midnight', () => {
    expect(formatEnd(zoned('2026-10-17T20:00:00'), zoned('2026-10-17T22:30:00'))).toBe('22:30');
    expect(formatEnd(zoned('2026-10-17T22:00:00'), zoned('2026-10-18T02:30:00'))).toBe('Sun 18 Oct 02:30');
  });
});

describe('English dates', () => {
  it('are British, without a leading zero on the day', () => {
    expect(formatDate('2026-11-04T10:00:00Z')).toBe('4 Nov 2026');
    expect(formatCalendarDay('2026-09-07')).toBe('7 Sept');
  });
});

describe('formatRelativeDay', () => {
  const now = at('2026-10-18T00:00:30');

  it('turns at midnight in the configured zone, not UTC', () => {
    expect(formatRelativeDay(zoned('2026-10-18T00:00:00'), now)).toBe('today');
    expect(formatRelativeDay(zoned('2026-10-17T23:59:59'), now)).toBe('yesterday');
    expect(formatRelativeDay(zoned('2026-10-17T00:00:00'), now)).toBe('yesterday');
    expect(formatRelativeDay(zoned('2026-10-16T23:59:59'), now)).toBe('on Fri 16 Oct');
    // 23:30 UTC on the 17th is already the 18th here.
    expect(formatRelativeDay('2026-10-17T23:30:00.000Z', at('2026-10-18T09:00:00'))).toBe('today');
  });
});
