import { and, asc, eq, gte, isNull, or } from 'drizzle-orm';
import { DAY_MS, MINUTE_MS, outageDurationMs, type StatsResponse, TRACKING_SINCE } from '../../shared/api';
import { outages } from '../db/schema';
import { outagesWithCounts } from '../lib/grid';
import { json } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { mergeOutages, weeklyStats, windowStats } from '../lib/stats';

async function getStats({ db }: RouteContext): Promise<Response> {
  const now = Date.now();
  const since = Date.parse(TRACKING_SINCE);
  const earliest = new Date(Math.max(since, now - 365 * DAY_MS)).toISOString();

  const rows = await db
    .select({ startTime: outages.startTime, endTime: outages.endTime, isPlanned: outages.isPlanned })
    .from(outages)
    .where(and(eq(outages.isFalsePositive, false), or(isNull(outages.endTime), gte(outages.endTime, earliest))));
  const intervals = mergeOutages(rows, now);
  const planned = mergeOutages(
    rows.filter((r) => r.isPlanned),
    now,
  );
  const window = (days: number, offsetDays = 0) =>
    windowStats(intervals, now - (days + offsetDays) * DAY_MS, now - offsetDays * DAY_MS, since, planned);

  const body: StatsResponse = {
    trackingSince: new Date(since).toISOString(),
    last7: window(7),
    last30: window(30),
    last365: window(365),
    previous30: now - 60 * DAY_MS >= since ? window(30, 30) : null,
    weeks: weeklyStats(intervals, now, since),
    generatedAt: new Date(now).toISOString(),
  };
  // Changes only when an outage starts or ends, so a minute of caching is harmless.
  return json(body, 200, { 'Cache-Control': 'public, max-age=60' });
}

function csvField(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Open data: every outage (false positives excluded) as CSV. */
async function getOutagesCsv({ db }: RouteContext): Promise<Response> {
  const rows = await outagesWithCounts(db, eq(outages.isFalsePositive, false)).orderBy(asc(outages.startTime));
  const lines = [
    'id,start_time_utc,end_time_utc,duration_minutes,planned,confirmations',
    ...rows.map((r) => {
      const minutes = r.endTime ? Math.round(outageDurationMs(r, 0) / MINUTE_MS) : null;
      return [r.id, r.startTime, r.endTime, minutes, r.isPlanned ? 'yes' : 'no', r.confirmations]
        .map(csvField)
        .join(',');
    }),
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="garsfontein-grid-outages.csv"',
      // About 80 bytes per outage, so even decades of data stay a few MB; a short cache keeps repeat downloads cheap.
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export const historyRoutes: Routes = {
  'GET /api/stats': { handler: getStats, limiter: 'STATUS_LIMITER', cors: true },
  'GET /api/outages.csv': { handler: getOutagesCsv, limiter: 'STATUS_LIMITER', cors: true },
};
