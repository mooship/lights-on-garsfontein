import { describe, expect, it } from 'vitest';
import { type StatsResponse, TRACKING_SINCE } from '../shared/api';
import { mergeOutages, weeklyStats, weekStartOf, windowStats } from '../worker/lib/stats';
import { call, insertOutage, uniqueIp } from './helpers';

const H = 3_600_000;
const t = (iso: string) => Date.parse(iso);

describe('mergeOutages', () => {
  it('merges overlapping outages so time is never double counted', () => {
    const merged = mergeOutages(
      [
        { startTime: '2026-11-02T10:00:00Z', endTime: '2026-11-02T12:00:00Z' },
        { startTime: '2026-11-02T11:00:00Z', endTime: '2026-11-02T13:00:00Z' },
        { startTime: '2026-11-03T10:00:00Z', endTime: '2026-11-03T11:00:00Z' },
      ],
      t('2026-11-10T00:00:00Z'),
    );
    expect(merged).toEqual([
      { start: t('2026-11-02T10:00:00Z'), end: t('2026-11-02T13:00:00Z') },
      { start: t('2026-11-03T10:00:00Z'), end: t('2026-11-03T11:00:00Z') },
    ]);
  });

  it('runs open outages until now', () => {
    const now = t('2026-11-02T12:30:00Z');
    expect(mergeOutages([{ startTime: '2026-11-02T12:00:00Z', endTime: null }], now)).toEqual([
      { start: t('2026-11-02T12:00:00Z'), end: now },
    ]);
  });
});

describe('windowStats', () => {
  const since = t('2026-10-18T00:00:00+02:00');

  it('sums hours off, counts outages and finds the longest', () => {
    const intervals = [
      { start: t('2026-11-02T10:00:00Z'), end: t('2026-11-02T12:30:00Z') },
      { start: t('2026-11-03T10:00:00Z'), end: t('2026-11-03T11:00:00Z') },
    ];
    const stats = windowStats(intervals, t('2026-11-01T00:00:00Z'), t('2026-11-05T00:00:00Z'), since);
    expect(stats).toEqual({
      trackedHours: 96,
      hoursOff: 3.5,
      outages: 2,
      availability: 0.9635,
      longestMinutes: 150,
    });
  });

  it('clips outages to the window edges', () => {
    const intervals = [{ start: t('2026-11-01T22:00:00Z'), end: t('2026-11-02T02:00:00Z') }];
    const stats = windowStats(intervals, t('2026-11-02T00:00:00Z'), t('2026-11-03T00:00:00Z'), since);
    expect(stats.hoursOff).toBe(2);
  });

  it('never counts time before tracking began', () => {
    const intervals = [{ start: t('2026-10-17T20:00:00+02:00'), end: t('2026-10-18T02:00:00+02:00') }];
    const stats = windowStats(intervals, since - 10 * 24 * H, since + 24 * H, since);
    expect(stats.trackedHours).toBe(24);
    expect(stats.hoursOff).toBe(2);
  });

  it('reports null availability before tracking starts', () => {
    expect(windowStats([], since - 48 * H, since - 24 * H, since).availability).toBeNull();
  });
});

describe('weekly stats', () => {
  it('uses Monday 00:00 South African time as the week start', () => {
    // Sunday 23:30 SAST belongs to the week that started six days earlier.
    expect(new Date(weekStartOf(t('2026-10-25T23:30:00+02:00'))).toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(new Date(weekStartOf(t('2026-10-26T00:00:00+02:00'))).toISOString()).toBe('2026-10-25T22:00:00.000Z');
  });

  it('starts at the tracking week and splits outages across week boundaries', () => {
    const since = t(TRACKING_SINCE);
    const intervals = [{ start: t('2026-10-25T22:00:00+02:00'), end: t('2026-10-26T03:00:00+02:00') }];
    const weeks = weeklyStats(intervals, t('2026-10-28T12:00:00+02:00'), since);
    // Tracking began on Sunday 18 Oct, so the first week is the one starting Monday 12 Oct.
    expect(weeks).toEqual([
      { weekStart: '2026-10-12', hoursOff: 0, outages: 0 },
      { weekStart: '2026-10-19', hoursOff: 2, outages: 1 },
      { weekStart: '2026-10-26', hoursOff: 3, outages: 1 },
    ]);
  });

  it('is empty before tracking begins', () => {
    const since = t(TRACKING_SINCE);
    expect(weeklyStats([], since - 1000, since)).toEqual([]);
  });

  it('caps the series at the requested number of weeks', () => {
    const since = t(TRACKING_SINCE);
    expect(weeklyStats([], since + 400 * 24 * H, since, 26)).toHaveLength(26);
  });
});

describe('GET /api/stats', () => {
  it('returns the stats shape with the tracking start date', async () => {
    await insertOutage({});
    const res = await call('/api/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    expect(body.trackingSince).toBe('2026-10-17T22:00:00.000Z');
    expect(body).toHaveProperty('last30.hoursOff');
    expect(Array.isArray(body.weeks)).toBe(true);
  });

  it('shares the status rate limit', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 60; i++) await call('/api/stats', { ip });
    expect((await call('/api/stats', { ip })).status).toBe(429);
  });
});

describe('GET /api/outages.csv', () => {
  it('exports outages as CSV without false positives', async () => {
    await insertOutage({ startTime: '2026-10-20T10:00:00.000Z', endTime: '2026-10-20T11:30:00.000Z' });
    await insertOutage({ startTime: '2026-10-21T10:00:00.000Z', endTime: null, source: 'manual' });
    await insertOutage({ startTime: '2026-10-22T10:00:00.000Z', isFalsePositive: 1 });
    const res = await call('/api/outages.csv');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toBe('id,start_time_utc,end_time_utc,duration_minutes,source,confirmations');
    expect(lines.slice(1).map((l) => l.split(',').slice(1).join(','))).toEqual([
      '2026-10-20T10:00:00.000Z,2026-10-20T11:30:00.000Z,90,sensor,0',
      '2026-10-21T10:00:00.000Z,,,manual,0',
    ]);
  });
});
