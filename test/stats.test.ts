import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { HOUR_MS as H, type StatsResponse, TRACKING_SINCE } from '../shared/api';
import { site } from '../site.config';
import { zoned } from '../src/lib/zone';
import { mergeOutages, weeklyStats, weekStartOf, windowStats } from '../worker/lib/stats';
import { call, insertOutage, sameWindow, uniqueIp } from './helpers';

const t = (iso: string) => Date.parse(iso);
/** The configured zone's UTC offset in ms; days and weeks start at local midnight. */
const OFFSET = site.utcOffsetMinutes * 60_000;

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
      // Reference: the plain per-day scan that windowStats's single forward pass replaces.
      const start = Math.max(from, since);
      let expected = 0;
      for (let day = Math.floor((start + OFFSET) / D) * D - OFFSET; day < to; day += D) {
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
  it('counts planned and open outages but not false positives', async () => {
    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const outages = [
      { startTime: ago(3 * H), endTime: ago(2 * H), isPlanned: 1 as const },
      { startTime: ago(H / 2), endTime: null },
    ];
    for (const outage of outages) await insertOutage(outage);
    await insertOutage({ startTime: ago(5 * H), endTime: ago(4 * H), isFalsePositive: 1 });

    const res = await call('/api/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    expect(body.trackingSince).toBe('2026-10-16T22:00:00.000Z');
    const window = { hoursOff: 1.5, outages: 2, plannedOutages: 1, longestMinutes: 60 };
    expect(body.last7).toMatchObject(window);
    expect(body.last30).toMatchObject(window);
    // Null until the 60 days it compares have both been tracked.
    if (now < t(TRACKING_SINCE) + 60 * 24 * H) expect(body.previous30).toBeNull();
    else expect(body.previous30).toMatchObject({ hoursOff: 0, outages: 0 });

    // This week's bar: the same outages, clipped to the week if it began less than 3 hours ago.
    const week = weekStartOf(now);
    const inWeek = outages.map((o) => Math.max(0, (o.endTime ? t(o.endTime) : now) - Math.max(t(o.startTime), week)));
    expect(body.weeks.at(-1)).toEqual({
      weekStart: new Date(week + OFFSET).toISOString().slice(0, 10),
      hoursOff: Math.round((inWeek.reduce((a, b) => a + b, 0) / H) * 10) / 10,
      outages: inWeek.filter((ms) => ms > 0).length,
    });
  });

  it('shares the status rate limit', async () => {
    const ip = uniqueIp();
    await sameWindow();
    for (let i = 0; i < 60; i++) await call('/api/stats', { ip });
    expect((await call('/api/stats', { ip })).status).toBe(429);
  });
});

describe('GET /api/outages.csv', () => {
  it('handles more outages than D1 allows bound parameters (100)', async () => {
    const insert = env.DB.prepare('INSERT INTO outages (start_time, end_time, source) VALUES (?, ?, ?)');
    await env.DB.batch(
      Array.from({ length: 120 }, (_, i) => {
        const start = new Date(Date.UTC(2026, 9, 18) + i * H);
        return insert.bind(start.toISOString(), new Date(start.getTime() + 600_000).toISOString(), 'manual');
      }),
    );
    const res = await call('/api/outages.csv');
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

    const res = await call('/api/outages.csv');
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
