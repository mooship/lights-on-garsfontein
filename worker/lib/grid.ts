import { and, count, desc, eq, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { DAY_MS, HEARTBEAT_THRESHOLD_MS, type OutageSummary, type PowerStatus } from '../../shared/api';
import type { Db } from '../db/client';
import { heartbeats, type Outage, outageConfirmations, outages, sessions } from '../db/schema';

const RECENT_LIMIT = 5;

/** Open and not flagged as a false positive. */
const isOpen = and(isNull(outages.endTime), eq(outages.isFalsePositive, false));

async function getHeartbeat(db: Db) {
  return db.query.heartbeats.findFirst({ where: eq(heartbeats.id, 1) });
}

/** The newest outage that is still open and not flagged as a false positive. */
export async function getOpenOutage(db: Db): Promise<Outage | undefined> {
  return db.query.outages.findFirst({ where: isOpen, orderBy: desc(outages.startTime) });
}

function isStale(lastSeen: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastSeen) > HEARTBEAT_THRESHOLD_MS;
}

/**
 * Confirmations per outage as a correlated subquery, so it only touches the outages the outer
 * query returns (covered by the unique (outage_id, client_hash) index). No bound parameter per
 * outage either: D1 allows at most 100 per query.
 */
const confirmationCount =
  sql<number>`(select count(*) from ${outageConfirmations} where ${outageConfirmations.outageId} = ${outages.id})`.mapWith(
    Number,
  );

export function outagesWithCounts(db: Db, where?: SQL) {
  return db
    .select({
      id: outages.id,
      startTime: outages.startTime,
      endTime: outages.endTime,
      source: outages.source,
      isFalsePositive: outages.isFalsePositive,
      isPlanned: outages.isPlanned,
      confirmations: confirmationCount,
    })
    .from(outages)
    .where(where);
}

export async function countConfirmations(db: Db, outageId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(outageConfirmations)
    .where(eq(outageConfirmations.outageId, outageId));
  return row?.total ?? 0;
}

/** The public shape of an outage row. */
export function summarise(
  outage: Pick<Outage, 'id' | 'startTime' | 'endTime' | 'isPlanned'>,
  confirmations: number,
): OutageSummary {
  const { id, startTime, endTime, isPlanned } = outage;
  return { id, startTime, endTime, confirmations, planned: isPlanned };
}

/** Until a sensor reports, the punch clock is the source of truth: no open outage means ON. */
function powerState(openStart: string | undefined, lastSeen: string | undefined, now: Date) {
  if (openStart) return { status: 'OFF' as PowerStatus, since: openStart };
  // A stale heartbeat is OFF straight away; the cron job opens the record within a minute.
  if (lastSeen && isStale(lastSeen, now)) return { status: 'OFF' as PowerStatus, since: lastSeen };
  return { status: 'ON' as PowerStatus, since: null };
}

/** Just ON or OFF, for callers that do not need the history (e.g. the social card). */
export async function getPowerStatus(db: Db, now: Date): Promise<PowerStatus> {
  const [heartbeat, open] = await Promise.all([getHeartbeat(db), getOpenOutage(db)]);
  return powerState(open?.startTime, heartbeat?.lastSeen, now).status;
}

export async function getGridState(db: Db, now: Date) {
  const [heartbeat, [open], recentRows] = await Promise.all([
    getHeartbeat(db),
    outagesWithCounts(db, isOpen).orderBy(desc(outages.startTime)).limit(1),
    outagesWithCounts(db, eq(outages.isFalsePositive, false)).orderBy(desc(outages.startTime)).limit(RECENT_LIMIT),
  ]);
  const state = powerState(open?.startTime, heartbeat?.lastSeen, now);
  return {
    status: state.status,
    // When ON, the current state began when the last outage ended.
    since: state.since ?? recentRows.find((o) => o.endTime)?.endTime ?? null,
    outage: open ? summarise(open, open.confirmations) : null,
    recent: recentRows.map((o) => summarise(o, o.confirmations)),
  };
}

/**
 * Opens a sensor outage when the heartbeat has gone stale and nothing is open yet.
 * Returns the open outage, if any. Safe to call repeatedly.
 */
export async function detectOutage(db: Db, now: Date): Promise<Outage | undefined> {
  const [open, heartbeat] = await Promise.all([getOpenOutage(db), getHeartbeat(db)]);
  if (open) return open;
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

const FINGERPRINT_DAYS = 30;

/**
 * Replaces confirmation fingerprints (salted IP hashes) older than 30 days with a
 * per-row placeholder: the count survives, the link to an address does not.
 */
export async function purgeOldFingerprints(db: Db, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - FINGERPRINT_DAYS * DAY_MS).toISOString();
  await db
    .update(outageConfirmations)
    .set({ clientHash: sql`'purged:' || ${outageConfirmations.id}` })
    .where(and(lt(outageConfirmations.createdAt, cutoff), sql`${outageConfirmations.clientHash} not like 'purged:%'`));
}
