import { and, count, desc, eq, gte, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import {
  DAY_MS,
  HEARTBEAT_THRESHOLD_MS,
  type OutageSource,
  type OutageSummary,
  type PowerStatus,
  STILL_OFF_DEDUPE_MS,
  STILL_OFF_WINDOW_MS,
} from '../../shared/api';
import type { Db } from '../db/client';
import { heartbeats, type Outage, outageConfirmations, outages, sessions, stillOffReports } from '../db/schema';

const RECENT_LIMIT = 5;

/** Open and not flagged as a false positive. */
const isOpen = and(isNull(outages.endTime), eq(outages.isFalsePositive, false));

/**
 * The sensor heartbeat, plus whether any outage (false positives included) starts at or after
 * it. If one does, the current silence is already on record: an admin who dismissed it as a
 * false positive (a dead sensor) is not overruled by showing OFF or opening it again.
 */
function heartbeatQuery(db: Db) {
  return db
    .select({
      lastSeen: heartbeats.lastSeen,
      onRecord:
        sql<boolean>`exists (select 1 from ${outages} where ${outages.startTime} >= ${heartbeats.lastSeen})`.mapWith(
          Boolean,
        ),
    })
    .from(heartbeats)
    .where(eq(heartbeats.id, 1))
    .limit(1);
}

type Heartbeat = { lastSeen: string; onRecord: boolean };

/** A plain select, not `findFirst`: relational queries break inside `db.batch` when nothing matches. */
function openOutageQuery(db: Db) {
  return db.select().from(outages).where(isOpen).orderBy(desc(outages.startTime)).limit(1);
}

/** The newest outage that is still open and not flagged as a false positive. */
export async function getOpenOutage(db: Db): Promise<Outage | undefined> {
  const [open] = await openOutageQuery(db);
  return open;
}

/**
 * Opens an outage unless one is already open (or `unless` matches any outage), as a single
 * statement so two concurrent callers cannot both open one. Returns whether a row was inserted.
 */
export async function openOutage(db: Db, startTime: string, source: OutageSource, unless?: SQL): Promise<boolean> {
  const blocked = unless ? or(isOpen, unless) : isOpen;
  const { meta } = await db.run(
    sql`insert into ${outages} (start_time, source) select ${startTime}, ${source} where not exists (select 1 from ${outages} where ${blocked})`,
  );
  return meta.changes > 0;
}

function isStale(lastSeen: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastSeen) > HEARTBEAT_THRESHOLD_MS;
}

/**
 * Confirmations per outage as a correlated subquery, so it only touches the outages the outer
 * query returns (covered by the unique (outage_id, client_hash) index). No bound parameter per
 * outage either: D1 allows at most 100 per query. Drizzle leaves columns unqualified in a
 * single-table select, where a bare "id" would mean the confirmation's own id, so both sides
 * name their table.
 */
const qualified = (table: typeof outages | typeof outageConfirmations, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`;
const confirmationCount =
  sql<number>`(select count(*) from ${outageConfirmations} where ${qualified(outageConfirmations, outageConfirmations.outageId)} = ${qualified(outages, outages.id)})`.mapWith(
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
  outage: Pick<Outage, 'id' | 'startTime' | 'endTime' | 'isPlanned'> & { confirmations: number },
): OutageSummary {
  const { id, startTime, endTime, isPlanned, confirmations } = outage;
  return { id, startTime, endTime, confirmations, planned: isPlanned };
}

/** Until a sensor reports, the punch clock is the source of truth: no open outage means ON. */
function powerState(
  openStart: string | undefined,
  heartbeat: Heartbeat | undefined,
  now: Date,
): { status: PowerStatus; since: string | null } {
  if (openStart) return { status: 'OFF', since: openStart };
  // A stale heartbeat is OFF straight away; the cron job opens the record within a minute.
  if (heartbeat && !heartbeat.onRecord && isStale(heartbeat.lastSeen, now)) {
    return { status: 'OFF', since: heartbeat.lastSeen };
  }
  return { status: 'ON', since: null };
}

/** "Still off" reports since `now - STILL_OFF_WINDOW_MS`. */
function stillOffCountQuery(db: Db, now: Date) {
  const since = new Date(now.getTime() - STILL_OFF_WINDOW_MS).toISOString();
  return db.select({ total: count() }).from(stillOffReports).where(gte(stillOffReports.createdAt, since));
}

export async function countStillOffReports(db: Db, now: Date): Promise<number> {
  const [row] = await stillOffCountQuery(db, now);
  return row?.total ?? 0;
}

/**
 * Records a "still off" report unless this client made one within STILL_OFF_DEDUPE_MS, as a
 * single statement so two concurrent requests cannot both insert. Returns whether it was recorded.
 */
export async function recordStillOff(db: Db, clientHash: string, now: Date): Promise<boolean> {
  const iso = now.toISOString();
  const recent = new Date(now.getTime() - STILL_OFF_DEDUPE_MS).toISOString();
  const { meta } = await db.run(
    sql`insert into ${stillOffReports} (created_at, client_hash) select ${iso}, ${clientHash} where not exists (select 1 from ${stillOffReports} where ${stillOffReports.clientHash} = ${clientHash} and ${stillOffReports.createdAt} >= ${recent})`,
  );
  return meta.changes > 0;
}

export async function getGridState(db: Db, now: Date) {
  const [[heartbeat], [open], recentRows, [stillOff]] = await db.batch([
    heartbeatQuery(db),
    outagesWithCounts(db, isOpen).orderBy(desc(outages.startTime)).limit(1),
    outagesWithCounts(db, eq(outages.isFalsePositive, false)).orderBy(desc(outages.startTime)).limit(RECENT_LIMIT),
    stillOffCountQuery(db, now),
  ]);
  const state = powerState(open?.startTime, heartbeat, now);
  // When ON, the current state began when the last outage ended (outages can overlap, so the latest end).
  const lastEnd = recentRows.reduce<string | null>(
    (max, o) => (o.endTime && (!max || o.endTime > max) ? o.endTime : max),
    null,
  );
  return {
    status: state.status,
    since: state.since ?? lastEnd,
    outage: open ? summarise(open) : null,
    recent: recentRows.map(summarise),
    // Whether a sensor is online now; says nothing about how any outage was recorded.
    monitored: heartbeat !== undefined && !isStale(heartbeat.lastSeen, now),
    stillOffReports: state.status === 'ON' ? (stillOff?.total ?? 0) : 0,
  };
}

/**
 * Opens a sensor outage when the heartbeat has gone stale and nothing is open yet. Returns the
 * open outage, if any, and whether this call opened it. Safe to call repeatedly and concurrently.
 */
export async function detectOutage(db: Db, now: Date): Promise<{ outage?: Outage; opened: boolean }> {
  const [[heartbeat], [open]] = await db.batch([heartbeatQuery(db), openOutageQuery(db)]);
  if (open) return { outage: open, opened: false };
  if (!heartbeat || heartbeat.onRecord || !isStale(heartbeat.lastSeen, now)) return { opened: false };
  // The insert re-checks both conditions, in case another request got there first.
  const opened = await openOutage(db, heartbeat.lastSeen, 'sensor', gte(outages.startTime, heartbeat.lastSeen));
  return { outage: await getOpenOutage(db), opened };
}

/**
 * Records a heartbeat and closes every open outage, manual ones included: the sensor seeing power
 * means power is on at the measuring point. If the heartbeat had gone stale but no outage was
 * opened for it (power came back between two cron runs), the gap is recorded as a closed sensor
 * outage, unless the gap is already on record or an open outage (closed here) covers it.
 */
export async function recordHeartbeat(db: Db, now: Date): Promise<number> {
  const iso = now.toISOString();
  const staleBefore = new Date(now.getTime() - HEARTBEAT_THRESHOLD_MS).toISOString();
  const anyOpen = isNull(outages.endTime);
  // Insert-select (raw `db.run` cannot be batched): it needs every column, in table order.
  const missedOutage = db
    .select({
      id: sql<number>`null`.as('id'),
      startTime: heartbeats.lastSeen,
      endTime: sql<string>`${iso}`.as('end_time'),
      source: sql<OutageSource>`'sensor'`.as('source'),
      isFalsePositive: sql<boolean>`0`.as('is_false_positive'),
      isPlanned: sql<boolean>`0`.as('is_planned'),
    })
    .from(heartbeats)
    .where(
      and(
        eq(heartbeats.id, 1),
        lt(heartbeats.lastSeen, staleBefore),
        sql`not exists (select 1 from ${outages} where ${outages.startTime} >= ${heartbeats.lastSeen} or ${anyOpen})`,
      ),
    );
  const [, , closed] = await db.batch([
    db.insert(outages).select(missedOutage),
    db
      .insert(heartbeats)
      .values({ id: 1, lastSeen: iso })
      .onConflictDoUpdate({ target: heartbeats.id, set: { lastSeen: iso } }),
    db.update(outages).set({ endTime: iso }).where(anyOpen).returning({ id: outages.id }),
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

const STILL_OFF_KEEP_DAYS = 90;

/**
 * "Still off" reports: fingerprints go after 30 days, like confirmations, and the rows after 90
 * (they only ever count for an hour).
 */
export async function purgeOldStillOffReports(db: Db, now: Date): Promise<void> {
  const fingerprintCutoff = new Date(now.getTime() - FINGERPRINT_DAYS * DAY_MS).toISOString();
  const rowCutoff = new Date(now.getTime() - STILL_OFF_KEEP_DAYS * DAY_MS).toISOString();
  await db.batch([
    db.delete(stillOffReports).where(lt(stillOffReports.createdAt, rowCutoff)),
    db
      .update(stillOffReports)
      .set({ clientHash: sql`'purged:' || ${stillOffReports.id}` })
      .where(
        and(lt(stillOffReports.createdAt, fingerprintCutoff), sql`${stillOffReports.clientHash} not like 'purged:%'`),
      ),
  ]);
}
