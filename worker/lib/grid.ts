import { and, count, desc, eq, gte, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import {
  DAY_MS,
  HEARTBEAT_THRESHOLD_MS,
  type OutageSource,
  type OutageSummary,
  type PowerStatus,
} from '../../shared/api';
import type { Db } from '../db/client';
import { heartbeats, type Outage, outageConfirmations, outages, sessions } from '../db/schema';

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

/** Just ON or OFF, for callers that do not need the history (e.g. the social card). */
export async function getPowerStatus(db: Db, now: Date): Promise<PowerStatus> {
  const [[heartbeat], [open]] = await db.batch([heartbeatQuery(db), openOutageQuery(db)]);
  return powerState(open?.startTime, heartbeat, now).status;
}

export async function getGridState(db: Db, now: Date) {
  const [[heartbeat], [open], recentRows] = await db.batch([
    heartbeatQuery(db),
    outagesWithCounts(db, isOpen).orderBy(desc(outages.startTime)).limit(1),
    outagesWithCounts(db, eq(outages.isFalsePositive, false)).orderBy(desc(outages.startTime)).limit(RECENT_LIMIT),
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
 * Records a heartbeat and closes any open sensor outages (power is back). If the heartbeat had
 * gone stale but no outage was opened for it (power came back between two cron runs), the gap
 * is recorded as a closed sensor outage, unless the gap is already on record.
 */
export async function recordHeartbeat(db: Db, now: Date): Promise<number> {
  const iso = now.toISOString();
  const staleBefore = new Date(now.getTime() - HEARTBEAT_THRESHOLD_MS).toISOString();
  const openSensor = and(isNull(outages.endTime), eq(outages.source, 'sensor'));
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
        sql`not exists (select 1 from ${outages} where ${outages.startTime} >= ${heartbeats.lastSeen} or ${openSensor})`,
      ),
    );
  const [, , closed] = await db.batch([
    db.insert(outages).select(missedOutage),
    db
      .insert(heartbeats)
      .values({ id: 1, lastSeen: iso })
      .onConflictDoUpdate({ target: heartbeats.id, set: { lastSeen: iso } }),
    db.update(outages).set({ endTime: iso }).where(openSensor).returning({ id: outages.id }),
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
