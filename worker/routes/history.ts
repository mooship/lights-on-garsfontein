import { and, asc, eq, gte, isNull, or } from 'drizzle-orm';
import { type StatsResponse, TRACKING_SINCE } from '../../shared/api';
import { createDb } from '../db/client';
import { outages } from '../db/schema';
import { confirmationCounts } from '../lib/grid';
import { clientIp, errors, isRateLimited, json, PUBLIC_CORS } from '../lib/http';
import { DAY_MS, mergeOutages, weeklyStats, windowStats } from '../lib/stats';

async function getStats(request: Request, env: Env): Promise<Response> {
  if (await isRateLimited(env.STATUS_LIMITER, clientIp(request))) return errors.rateLimited();
  const now = Date.now();
  const since = Date.parse(TRACKING_SINCE);
  const earliest = new Date(Math.max(since, now - 365 * DAY_MS)).toISOString();

  const rows = await createDb(env.DB)
    .select({ startTime: outages.startTime, endTime: outages.endTime })
    .from(outages)
    .where(and(eq(outages.isFalsePositive, 0), or(isNull(outages.endTime), gte(outages.endTime, earliest))));
  const intervals = mergeOutages(rows, now);
  const window = (days: number, offsetDays = 0) =>
    windowStats(intervals, now - (days + offsetDays) * DAY_MS, now - offsetDays * DAY_MS, since);

  const body: StatsResponse = {
    trackingSince: new Date(since).toISOString(),
    last7: window(7),
    last30: window(30),
    last365: window(365),
    previous30: now - 60 * DAY_MS >= since ? window(30, 30) : null,
    weeks: weeklyStats(intervals, now, since),
    generatedAt: new Date(now).toISOString(),
  };
  return json(body, 200, PUBLIC_CORS);
}

function csvField(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Open data: every outage (false positives excluded) as CSV. */
async function getOutagesCsv(request: Request, env: Env): Promise<Response> {
  if (await isRateLimited(env.STATUS_LIMITER, clientIp(request))) return errors.rateLimited();
  const db = createDb(env.DB);
  const rows = await db.query.outages.findMany({
    where: eq(outages.isFalsePositive, 0),
    orderBy: asc(outages.startTime),
  });
  const counts = await confirmationCounts(
    db,
    rows.map((r) => r.id),
  );
  const lines = [
    'id,start_time_utc,end_time_utc,duration_minutes,source,confirmations',
    ...rows.map((r) => {
      const minutes = r.endTime ? Math.round((Date.parse(r.endTime) - Date.parse(r.startTime)) / 60_000) : null;
      return [r.id, r.startTime, r.endTime, minutes, r.source, counts.get(r.id) ?? 0].map(csvField).join(',');
    }),
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="garsfontein-grid-outages.csv"',
      'Cache-Control': 'no-store',
      ...PUBLIC_CORS,
    },
  });
}

export async function handleHistoryRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/stats':
      return getStats(request, env);
    case 'GET /api/outages.csv':
      return getOutagesCsv(request, env);
    default:
      return null;
  }
}
