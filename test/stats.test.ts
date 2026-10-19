import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_MS,
  HOUR_MS as H,
  MINUTE_MS,
  type OutagesResponse,
  RECENT_LIMIT,
  type StatsResponse,
  TRACKING_SINCE,
  UTC_OFFSET_MS,
} from '../shared/api';
import { CSV_PATH, OUTAGES_PATH, STATS_PATH } from '../shared/paths';
import { site } from '../site.config';
import { zoned } from '../src/lib/zone';
import { hourlyMinutes, mergeOutages, weeklyStats, weekStartOf, windowStats } from '../worker/lib/stats';
import { call, insertOutage, stubLimiter } from './helpers';

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
  const since = t(zoned('2026-10-18T00:00:00'));

  it('sums hours off, counts outages and finds the longest', () => {
    const intervals = [
      { start: t('2026-11-02T10:00:00Z'), end: t('2026-11-02T12:30:00Z') },
      { start: t('2026-11-03T10:00:00Z'), end: t('2026-11-03T11:00:00Z') },
    ];
    const stats = windowStats(intervals, t('2026-11-01T00:00:00Z'), t('2026-11-05T00:00:00Z'), since);
    expect(stats).toEqual({
      trackedHours: 96,
      hoursOff: 3.5,
      minutesOff: 210,
      outages: 2,
      availability: 0.9635,
      longestMinutes: 150,
      daysTracked: 5,
      daysWithOutage: 2,
      plannedOutages: 0,
    });
  });

  it('clips outages to the window edges', () => {
    const intervals = [{ start: t('2026-11-01T22:00:00Z'), end: t('2026-11-02T02:00:00Z') }];
    const stats = windowStats(intervals, t('2026-11-02T00:00:00Z'), t('2026-11-03T00:00:00Z'), since);
    expect(stats.hoursOff).toBe(2);
  });

  it('gives the time off in whole minutes, so it matches the longest outage', () => {
    const intervals = [{ start: t('2026-11-02T03:52:00Z'), end: t('2026-11-02T09:15:00Z') }];
    const stats = windowStats(intervals, t('2026-11-01T00:00:00Z'), t('2026-11-03T00:00:00Z'), since);
    expect(stats).toMatchObject({ hoursOff: 5.4, minutesOff: 323, longestMinutes: 323 });
  });

  it('never counts time before tracking began', () => {
    const intervals = [{ start: t(zoned('2026-10-17T20:00:00')), end: t(zoned('2026-10-18T02:00:00')) }];
    const stats = windowStats(intervals, since - 10 * 24 * H, since + 24 * H, since);
    expect(stats.trackedHours).toBe(24);
    expect(stats.hoursOff).toBe(2);
  });

  it('counts calendar days in the configured zone with any outage', () => {
    // 23:30–00:30 local time spans two days; the third day is clean.
    const intervals = [{ start: t(zoned('2026-11-02T23:30:00')), end: t(zoned('2026-11-03T00:30:00')) }];
    const stats = windowStats(intervals, t(zoned('2026-11-02T00:00:00')), t(zoned('2026-11-05T00:00:00')), since);
    expect(stats).toMatchObject({ daysTracked: 3, daysWithOutage: 2 });
  });

  it('counts an outage crossing local midnight on both days, and skips days between outages', () => {
    const intervals = mergeOutages(
      [
        { startTime: zoned('2026-11-02T22:00:00'), endTime: zoned('2026-11-03T01:00:00') },
        { startTime: zoned('2026-11-04T08:00:00'), endTime: zoned('2026-11-04T09:00:00') },
        { startTime: zoned('2026-11-05T23:59:00'), endTime: zoned('2026-11-06T00:01:00') },
      ],
      t('2026-11-10T00:00:00Z'),
    );
    // Starts mid-afternoon on the 2nd and stops just after midnight on the 6th.
    const stats = windowStats(intervals, t(zoned('2026-11-02T15:00:00')), t(zoned('2026-11-06T00:00:30')), since);
    expect(stats).toMatchObject({ daysTracked: 5, daysWithOutage: 5 });
    const gap = windowStats(intervals, t(zoned('2026-11-02T00:00:00')), t(zoned('2026-11-09T00:00:00')), since);
    // 2nd, 3rd, 4th, 5th and 6th had outages; 7th and 8th were clean.
    expect(gap).toMatchObject({ daysTracked: 7, daysWithOutage: 5 });
  });

  it('counts the same days with an outage as checking every outage against every day', () => {
    const D = 24 * H;
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 50; run++) {
      const base = since + Math.floor(random() * 10) * D;
      const rows = Array.from({ length: Math.floor(random() * 12) }, () => {
        const start = base + random() * 20 * D;
        return { startTime: new Date(start).toISOString(), endTime: new Date(start + random() * 2 * D).toISOString() };
      });
      const intervals = mergeOutages(rows, base + 30 * D);
      const from = base + random() * 5 * D;
      const to = from + random() * 25 * D;
      // Reference: a plain per-day scan to check windowStats's single forward pass against.
      const start = Math.max(from, since);
      let expected = 0;
      for (let day = Math.floor((start + UTC_OFFSET_MS) / D) * D - UTC_OFFSET_MS; day < to; day += D) {
        const dayFrom = Math.max(day, start);
        const dayTo = Math.min(day + D, to);
        if (intervals.some((i) => Math.min(i.end, dayTo) - Math.max(i.start, dayFrom) > 0)) expected += 1;
      }
      expect(windowStats(intervals, from, to, since).daysWithOutage).toBe(expected);
    }
  });

  it('counts planned outages separately but still as time without power', () => {
    const all = [
      { start: t('2026-11-02T08:00:00Z'), end: t('2026-11-02T10:00:00Z') },
      { start: t('2026-11-03T08:00:00Z'), end: t('2026-11-03T09:00:00Z') },
    ];
    const planned = [all[0] as (typeof all)[number]];
    const stats = windowStats(all, t('2026-11-01T00:00:00Z'), t('2026-11-05T00:00:00Z'), since, planned);
    expect(stats).toMatchObject({ hoursOff: 3, outages: 2, plannedOutages: 1 });
  });

  it('reports null availability before tracking starts', () => {
    expect(windowStats([], since - 48 * H, since - 24 * H, since).availability).toBeNull();
  });
});

describe('weekly stats', () => {
  it('uses Monday 00:00 in the configured zone as the week start', () => {
    // Sunday 23:30 local time belongs to the week that started six days earlier.
    expect(weekStartOf(t(zoned('2026-10-25T23:30:00')))).toBe(t(zoned('2026-10-19T00:00:00')));
    expect(weekStartOf(t(zoned('2026-10-26T00:00:00')))).toBe(t(zoned('2026-10-26T00:00:00')));
  });

  it('starts at the tracking week and splits outages across week boundaries', () => {
    const since = t(TRACKING_SINCE);
    const intervals = [{ start: t(zoned('2026-10-25T22:00:00')), end: t(zoned('2026-10-26T03:00:00')) }];
    const weeks = weeklyStats(intervals, t(zoned('2026-10-28T12:00:00')), since);
    // Tracking began on Saturday 17 Oct, so the first week is the one starting Monday 12 Oct.
    expect(weeks).toEqual([
      { weekStart: '2026-10-12', hoursOff: 0, minutesOff: 0, outages: 0 },
      { weekStart: '2026-10-19', hoursOff: 2, minutesOff: 120, outages: 1 },
      { weekStart: '2026-10-26', hoursOff: 3, minutesOff: 180, outages: 1 },
    ]);
  });

  it('is empty before tracking begins', () => {
    const since = t(TRACKING_SINCE);
    expect(weeklyStats([], since - 1000, since)).toEqual([]);
  });

  it('caps the series at 26 weeks', () => {
    const since = t(TRACKING_SINCE);
    expect(weeklyStats([], since + 400 * 24 * H, since)).toHaveLength(26);
  });
});

describe('hourlyMinutes', () => {
  const since = t(TRACKING_SINCE);
  const from = since;
  const to = t(zoned('2026-11-30T00:00:00'));
  const span = (a: string, b: string) => [{ start: t(zoned(a)), end: t(zoned(b)) }];
  const only = (entries: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => entries[hour] ?? 0);

  it('splits an outage across the local clock hours it covers', () => {
    expect(hourlyMinutes(span('2026-10-20T17:30:00', '2026-10-20T19:15:00'), from, to, since)).toEqual(
      only({ 17: 30, 18: 60, 19: 15 }),
    );
  });

  it('splits an outage across local midnight', () => {
    expect(hourlyMinutes(span('2026-10-20T23:30:00', '2026-10-21T00:30:00'), from, to, since)).toEqual(
      only({ 23: 30, 0: 30 }),
    );
  });

  it('adds up the same hour on different days', () => {
    const intervals = [
      ...span('2026-10-20T18:00:00', '2026-10-20T18:20:00'),
      ...span('2026-10-22T18:30:00', '2026-10-22T18:40:00'),
    ];
    expect(hourlyMinutes(intervals, from, to, since)).toEqual(only({ 18: 30 }));
  });

  it('counts only the part inside the window and after tracking began', () => {
    const intervals = span('2026-10-16T23:00:00', '2026-10-17T01:00:00');
    expect(hourlyMinutes(intervals, from, to, since)).toEqual(only({ 0: 60 }));
    const windowFrom = t(zoned('2026-10-17T00:30:00'));
    expect(hourlyMinutes(intervals, windowFrom, to, since)).toEqual(only({ 0: 30 }));
  });

  it('is 24 zeros without outages', () => {
    expect(hourlyMinutes([], from, to, since)).toEqual(only({}));
  });
});

describe('GET /api/stats', () => {
  it('gives the minutes without power in each local hour over the last 30 days, without false positives', async () => {
    const now = Date.now();
    // Whole local hours two and three hours ago, so the test does not depend on the time it runs.
    const hourStart = (ms: number) => Math.floor((ms + UTC_OFFSET_MS) / H) * H - UTC_OFFSET_MS;
    const start = hourStart(now) - 3 * H;
    await insertOutage({ startTime: new Date(start).toISOString(), endTime: new Date(start + H).toISOString() });
    await insertOutage({
      startTime: new Date(start + H).toISOString(),
      endTime: new Date(start + 2 * H).toISOString(),
      isFalsePositive: 1,
    });
    const body = (await (await call(STATS_PATH)).json()) as StatsResponse;
    const hour = new Date(start + UTC_OFFSET_MS).getUTCHours();
    expect(body.last30ByHour).toHaveLength(24);
    expect(body.last30ByHour[hour]).toBe(60);
    expect(body.last30ByHour.reduce((a, b) => a + b, 0)).toBe(60);
  });

  it('counts planned and open outages but not false positives', async () => {
    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const outages = [
      { startTime: ago(3 * H), endTime: ago(2 * H), isPlanned: 1 as const },
      { startTime: ago(H / 2), endTime: null },
    ];
    for (const outage of outages) await insertOutage(outage);
    await insertOutage({ startTime: ago(5 * H), endTime: ago(4 * H), isFalsePositive: 1 });

    const res = await call(STATS_PATH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    expect(body.trackingSince).toBe(new Date(TRACKING_SINCE).toISOString());
    const window = { hoursOff: 1.5, minutesOff: 90, outages: 2, plannedOutages: 1, longestMinutes: 60 };
    expect(body.last7).toMatchObject(window);
    expect(body.last30).toMatchObject(window);

    // This week's bar: the same outages, clipped to the week if it began less than 3 hours ago.
    const week = weekStartOf(now);
    const inWeek = outages.map((o) => Math.max(0, (o.endTime ? t(o.endTime) : now) - Math.max(t(o.startTime), week)));
    expect(body.weeks.at(-1)).toEqual({
      weekStart: new Date(week + UTC_OFFSET_MS).toISOString().slice(0, 10),
      hoursOff: Math.round((inWeek.reduce((a, b) => a + b, 0) / H) * 10) / 10,
      minutesOff: Math.round(inWeek.reduce((a, b) => a + b, 0) / MINUTE_MS),
      outages: inWeek.filter((ms) => ms > 0).length,
    });
  });

  it('shares the status rate limit', async () => {
    const limiter = stubLimiter();
    expect((await call(STATS_PATH, { env: { ...env, STATUS_LIMITER: limiter } })).status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledOnce();
  });
});

describe('GET /api/outages.csv', () => {
  it('handles more outages than D1 allows bound parameters (100)', async () => {
    const insert = env.DB.prepare('INSERT INTO outages (start_time, end_time, source) VALUES (?, ?, ?)');
    await env.DB.batch(
      Array.from({ length: 120 }, (_, i) => {
        const start = new Date(Date.UTC(2026, 9, 18) + i * H);
        return insert.bind(start.toISOString(), new Date(start.getTime() + 10 * MINUTE_MS).toISOString(), 'manual');
      }),
    );
    const res = await call(CSV_PATH);
    expect(res.status).toBe(200);
    expect((await res.text()).trim().split('\n')).toHaveLength(121);
  });

  it('exports every outage but false positives, oldest first, in its stable columns', async () => {
    // Inserted newest first, so the id order is the reverse of the start order.
    const open = await insertOutage({ startTime: '2026-10-22T10:00:00.000Z', endTime: null, source: 'manual' });
    await insertOutage({ startTime: '2026-10-21T12:00:00.000Z', isFalsePositive: 1 });
    const planned = await insertOutage({
      startTime: '2026-10-21T06:00:00.000Z',
      endTime: '2026-10-21T10:00:20.000Z',
      isPlanned: 1,
    });
    const closed = await insertOutage({
      startTime: '2026-10-20T10:00:00.000Z',
      endTime: '2026-10-20T11:30:00.000Z',
    });

    const res = await call(CSV_PATH);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${site.slug}-outages.csv"`);
    expect(await res.text()).toBe(
      [
        'id,start_time_utc,end_time_utc,duration_minutes,planned',
        `${closed},2026-10-20T10:00:00.000Z,2026-10-20T11:30:00.000Z,90,no`,
        `${planned},2026-10-21T06:00:00.000Z,2026-10-21T10:00:20.000Z,240,yes`,
        `${open},2026-10-22T10:00:00.000Z,,,no`,
        '',
      ].join('\n'),
    );
  });
});

describe('GET /api/outages', () => {
  it('lists every outage but false positives, newest first, in the public shape', async () => {
    const closed = await insertOutage({ startTime: '2026-10-20T10:00:00.000Z', endTime: '2026-10-20T11:30:00.000Z' });
    await insertOutage({ startTime: '2026-10-21T12:00:00.000Z', isFalsePositive: 1 });
    const planned = await insertOutage({
      startTime: '2026-10-21T06:00:00.000Z',
      endTime: '2026-10-21T10:00:00.000Z',
      isPlanned: 1,
    });
    const open = await insertOutage({ startTime: '2026-10-22T10:00:00.000Z', source: 'manual' });

    const res = await call(OUTAGES_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = (await res.json()) as OutagesResponse;
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.outages).toEqual([
      { id: open, startTime: '2026-10-22T10:00:00.000Z', endTime: null, planned: false },
      { id: planned, startTime: '2026-10-21T06:00:00.000Z', endTime: '2026-10-21T10:00:00.000Z', planned: true },
      { id: closed, startTime: '2026-10-20T10:00:00.000Z', endTime: '2026-10-20T11:30:00.000Z', planned: false },
    ]);
  });

  it('lists more outages than the status does', async () => {
    for (let i = 0; i <= RECENT_LIMIT; i++) {
      const start = Date.UTC(2026, 9, 18) + i * H;
      await insertOutage({
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + MINUTE_MS).toISOString(),
      });
    }
    const { outages } = (await (await call(OUTAGES_PATH)).json()) as OutagesResponse;
    expect(outages).toHaveLength(RECENT_LIMIT + 1);
  });
});

describe('GET /api/stats over time', () => {
  /** Sets the clock this many days after tracking began; outages are placed relative to it. */
  const daysTracked = (days: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t(TRACKING_SINCE) + days * DAY_MS);
    return Date.now();
  };
  afterEach(() => vi.useRealTimers());

  const stats = async () => (await (await call(STATS_PATH)).json()) as StatsResponse;

  it('has no previous 30 days to compare until 60 days are on record', async () => {
    daysTracked(59);
    expect((await stats()).previous30).toBeNull();
  });

  it('compares the last 30 days with the 30 before them once both are on record', async () => {
    const now = daysTracked(61);
    const ago = (ms: number) => new Date(now - ms).toISOString();
    await insertOutage({ startTime: ago(45 * DAY_MS), endTime: ago(45 * DAY_MS - 2 * H) });
    await insertOutage({ startTime: ago(40 * DAY_MS), endTime: ago(40 * DAY_MS - 30 * MINUTE_MS) });
    await insertOutage({ startTime: ago(10 * DAY_MS), endTime: ago(10 * DAY_MS - H) });
    const body = await stats();
    expect(body.previous30).toMatchObject({ hoursOff: 2.5, minutesOff: 150, outages: 2, longestMinutes: 120 });
    expect(body.last30).toMatchObject({ hoursOff: 1, minutesOff: 60, outages: 1 });
  });

  it('counts an outage across the two windows in each, for its part there', async () => {
    const now = daysTracked(61);
    const ago = (ms: number) => new Date(now - ms).toISOString();
    await insertOutage({ startTime: ago(30 * DAY_MS + H), endTime: ago(30 * DAY_MS - H) });
    const body = await stats();
    expect(body.previous30).toMatchObject({ minutesOff: 60, outages: 1 });
    expect(body.last30).toMatchObject({ minutesOff: 60, outages: 1 });
  });

  // Public contract: fields are only ever added (AGENTS.md), so none of these may disappear.
  it('keeps every field of its public contract', async () => {
    const body = await stats();
    for (const key of [
      'trackingSince',
      'last7',
      'last30',
      'last365',
      'previous30',
      'weeks',
      'last30ByHour',
      'generatedAt',
    ]) {
      expect(body, key).toHaveProperty(key);
    }
    for (const key of [
      'trackedHours',
      'hoursOff',
      'minutesOff',
      'outages',
      'availability',
      'longestMinutes',
      'daysTracked',
      'daysWithOutage',
      'plannedOutages',
    ]) {
      expect(body.last30, key).toHaveProperty(key);
    }
    expect(Object.keys(body.weeks[0] ?? {})).toEqual(['weekStart', 'hoursOff', 'minutesOff', 'outages']);
  });
});
