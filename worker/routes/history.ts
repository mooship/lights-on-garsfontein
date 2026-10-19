import { and, asc, desc, eq, gte, isNull, or } from 'drizzle-orm';
import {
  CSV_FILE_NAME,
  DAY_MS,
  MINUTE_MS,
  outageDurationMs,
  type StatsResponse,
  TRACKING_SINCE,
} from '../../shared/api';
import { CSV_PATH, FEED_PATH, STATS_PATH } from '../../shared/paths';
import { site } from '../../site.config';
import { outages } from '../db/schema';
import { json, publicCache } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { hourlyMinutes, mergeOutages, weeklyStats, windowStats } from '../lib/stats';

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
    last30ByHour: hourlyMinutes(intervals, now - 30 * DAY_MS, now, since),
    generatedAt: new Date(now).toISOString(),
  };
  // Changes only when an outage starts or ends, so a minute of caching is harmless.
  return json(body, 200, { 'Cache-Control': publicCache(MINUTE_MS) });
}

function csvField(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Open data: every outage (false positives excluded) as CSV, oldest first.
 *
 * The columns are a stable public contract that other people's scripts read, so don't rename,
 * reorder or reformat them; add new columns only at the end, and note any change with a version
 * in the README. `start_time_utc` and `end_time_utc` are ISO 8601 UTC; `end_time_utc` and
 * `duration_minutes` (whole minutes) are empty while the outage is open; `planned` is yes or no.
 */
async function getOutagesCsv({ db }: RouteContext): Promise<Response> {
  const rows = await db
    .select()
    .from(outages)
    .where(eq(outages.isFalsePositive, false))
    .orderBy(asc(outages.startTime));
  const lines = [
    'id,start_time_utc,end_time_utc,duration_minutes,planned',
    ...rows.map((r) => {
      const minutes = r.endTime ? Math.round(outageDurationMs(r, 0) / MINUTE_MS) : null;
      return [r.id, r.startTime, r.endTime, minutes, r.isPlanned ? 'yes' : 'no'].map(csvField).join(',');
    }),
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${CSV_FILE_NAME}"`,
      // About 80 bytes per outage, so even decades of data stay a few MB; a short cache keeps repeat downloads cheap.
      'Cache-Control': publicCache(5 * MINUTE_MS),
    },
  });
}

const FEED_LIMIT = 20;

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);

const feedDateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: site.timeZone,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "17 Oct 2026 14:05" in the configured zone, built from parts so ICU punctuation cannot vary. */
function feedDate(iso: string): string {
  const part = Object.fromEntries(feedDateParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${part.day} ${part.month} ${part.year} ${part.hour}:${part.minute}`;
}

/** "2 h 10 min", "3 h" or "45 min". */
function feedDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}

/**
 * Atom feed of the latest outages (false positives excluded), newest first. English only, as feeds
 * are read by software, so it skips the site's dictionaries.
 */
async function getFeed({ env, db }: RouteContext): Promise<Response> {
  const rows = await db
    .select({ id: outages.id, startTime: outages.startTime, endTime: outages.endTime, isPlanned: outages.isPlanned })
    .from(outages)
    .where(eq(outages.isFalsePositive, false))
    .orderBy(desc(outages.startTime))
    .limit(FEED_LIMIT);
  const home = `${env.SITE_URL}/`;
  const entries = rows.map((r) => {
    const kind = r.isPlanned ? 'Planned outage' : 'Outage';
    const start = feedDate(r.startTime);
    const title = r.endTime
      ? `${kind} ${start} (${feedDuration(outageDurationMs(r, 0))})`
      : `${kind} in progress since ${start}`;
    const summary = r.endTime ? `Started ${start}, ended ${feedDate(r.endTime)}.` : `Started ${start}; not over yet.`;
    return { id: r.id, title, summary, updated: r.endTime ?? r.startTime };
  });
  // Stable while nothing changes, so readers and caches see the same document.
  const updated = entries.reduce(
    (max, e) => (e.updated > max ? e.updated : max),
    new Date(TRACKING_SINCE).toISOString(),
  );
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(site.brand.full)}</title>
  <id>${escapeXml(`${env.SITE_URL}${FEED_PATH}`)}</id>
  <link rel="self" href="${escapeXml(`${env.SITE_URL}${FEED_PATH}`)}"/>
  <link rel="alternate" type="text/html" href="${escapeXml(home)}"/>
  <updated>${updated}</updated>
  <author><name>${escapeXml(site.operator.name)}</name></author>
${entries
  .map(
    (e) => `  <entry>
    <title>${escapeXml(e.title)}</title>
    <id>${escapeXml(`${home}#outage-${e.id}`)}</id>
    <link rel="alternate" type="text/html" href="${escapeXml(home)}"/>
    <updated>${e.updated}</updated>
    <summary>${escapeXml(e.summary)}</summary>
  </entry>
`,
  )
  .join('')}</feed>
`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': publicCache(5 * MINUTE_MS) },
  });
}

export const historyRoutes: Routes = {
  [`GET ${FEED_PATH}`]: { handler: getFeed, limiter: 'STATUS_LIMITER', cors: true, edgeCache: true },
  [`GET ${STATS_PATH}`]: { handler: getStats, limiter: 'STATUS_LIMITER', cors: true, edgeCache: true },
  [`GET ${CSV_PATH}`]: { handler: getOutagesCsv, limiter: 'STATUS_LIMITER', cors: true, edgeCache: true },
};
