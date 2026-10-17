import { and, count, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import { HEARTBEAT_THRESHOLD_MS, type OutageSummary, type PowerStatus } from '../../shared/api';
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

/**
 * Outages with their confirmation counts in one JOIN. (Passing outage ids as parameters
 * would break past 100 outages: D1 allows at most 100 bound parameters per query.)
 */
export function outagesWithCounts(db: Db, where?: SQL) {
  return db
    .select({
      id: outages.id,
      startTime: outages.startTime,
      endTime: outages.endTime,
      source: outages.source,
      isFalsePositive: outages.isFalsePositive,
      confirmations: count(outageConfirmations.id),
    })
    .from(outages)
    .leftJoin(outageConfirmations, eq(outageConfirmations.outageId, outages.id))
    .where(where)
    .groupBy(outages.id);
}

export async function countConfirmations(db: Db, outageId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(outageConfirmations)
    .where(eq(outageConfirmations.outageId, outageId));
  return row?.total ?? 0;
}

function summarise(outage: Pick<Outage, 'id' | 'startTime' | 'endTime'>, confirmations: number): OutageSummary {
  const { id, startTime, endTime } = outage;
  return { id, startTime, endTime, confirmations };
}

export async function getGridState(db: Db, now: Date) {
  const [heartbeat, open, recentRows] = await Promise.all([
    getHeartbeat(db),
    getOpenOutage(db),
    outagesWithCounts(db, eq(outages.isFalsePositive, 0)).orderBy(desc(outages.startTime)).limit(RECENT_LIMIT),
  ]);
  const openConfirmations = open ? await countConfirmations(db, open.id) : 0;
  const lastSeen = heartbeat?.lastSeen ?? null;

  // Until a sensor reports, the admin's punch clock is the source of truth: no open outage means ON.
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
    since,
    outage: open ? summarise(open, openConfirmations) : null,
    recent: recentRows.map((o) => summarise(o, o.confirmations)),
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
