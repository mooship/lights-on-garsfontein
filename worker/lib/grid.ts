import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { HEARTBEAT_THRESHOLD_MS, type OutageSummary, type PowerStatus, type StatusMode } from '../../shared/api';
import type { Db } from '../db/client';
import { heartbeats, type Outage, outageConfirmations, outages, sessions } from '../db/schema';

const RECENT_LIMIT = 5;

export async function getHeartbeat(db: Db) {
  return db.query.heartbeats.findFirst({ where: eq(heartbeats.id, 1) });
}

/** The newest outage that is still open and not flagged as a false positive. */
export async function getOpenOutage(db: Db): Promise<Outage | undefined> {
  return db.query.outages.findFirst({
    where: and(isNull(outages.endTime), eq(outages.isFalsePositive, 0)),
    orderBy: desc(outages.startTime),
  });
}

export function isStale(lastSeen: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastSeen) > HEARTBEAT_THRESHOLD_MS;
}

export async function confirmationCounts(db: Db, ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ outageId: outageConfirmations.outageId, total: count() })
    .from(outageConfirmations)
    .where(inArray(outageConfirmations.outageId, ids))
    .groupBy(outageConfirmations.outageId);
  return new Map(rows.map((r) => [r.outageId, r.total]));
}

function summarise(outage: Outage, counts: Map<number, number>): OutageSummary {
  return {
    id: outage.id,
    startTime: outage.startTime,
    endTime: outage.endTime,
    source: outage.source,
    confirmations: counts.get(outage.id) ?? 0,
  };
}

export async function getGridState(db: Db, now: Date) {
  const [heartbeat, open, recentRows] = await Promise.all([
    getHeartbeat(db),
    getOpenOutage(db),
    db.query.outages.findMany({
      where: eq(outages.isFalsePositive, 0),
      orderBy: desc(outages.startTime),
      limit: RECENT_LIMIT,
    }),
  ]);
  const ids = [...new Set([...recentRows.map((o) => o.id), ...(open ? [open.id] : [])])];
  const counts = await confirmationCounts(db, ids);
  const lastSeen = heartbeat?.lastSeen ?? null;

  // Without a sensor the admin's punch clock is the source of truth: no open outage means ON.
  const mode: StatusMode = lastSeen ? 'sensor' : 'manual';
  let status: PowerStatus;
  let since: string | null;
  if (open) {
    status = 'OFF';
    since = open.startTime;
  } else if (lastSeen && isStale(lastSeen, now)) {
    // The cron job opens a record within a minute; report OFF straight away.
    status = 'OFF';
    since = lastSeen;
  } else {
    status = 'ON';
    since = recentRows.find((o) => o.endTime)?.endTime ?? null;
  }

  return {
    status,
    mode,
    since,
    lastSeen,
    outage: open ? summarise(open, counts) : null,
    recent: recentRows.map((o) => summarise(o, counts)),
  };
}

/**
 * Opens a sensor outage when the heartbeat has gone stale and nothing is open yet.
 * Returns the open outage, if any. Safe to call repeatedly.
 */
export async function detectOutage(db: Db, now: Date): Promise<Outage | undefined> {
  const open = await getOpenOutage(db);
  if (open) return open;
  const heartbeat = await getHeartbeat(db);
  if (!heartbeat || !isStale(heartbeat.lastSeen, now)) return undefined;
  const [created] = await db.insert(outages).values({ startTime: heartbeat.lastSeen, source: 'sensor' }).returning();
  return created;
}

/** Records a heartbeat and closes any open sensor outages (power is back). */
export async function recordHeartbeat(db: Db, now: Date): Promise<number> {
  const iso = now.toISOString();
  const [, closed] = await db.batch([
    db
      .insert(heartbeats)
      .values({ id: 1, lastSeen: iso })
      .onConflictDoUpdate({ target: heartbeats.id, set: { lastSeen: iso } }),
    db
      .update(outages)
      .set({ endTime: iso })
      .where(and(isNull(outages.endTime), eq(outages.source, 'sensor')))
      .returning({ id: outages.id }),
  ]);
  return closed.length;
}

export async function purgeExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString()));
}
