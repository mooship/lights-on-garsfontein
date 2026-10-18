import { and, desc, eq, gt, gte, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { HEARTBEAT_THRESHOLD_MS, type OutageSource, type OutageSummary, type PowerStatus } from '../../shared/api';
import type { Db } from '../db/client';
import { heartbeats, type Outage, outages, sessions } from '../db/schema';

const RECENT_LIMIT = 5;

/** Open and not flagged as a false positive. */
const isOpen = and(isNull(outages.endTime), eq(outages.isFalsePositive, false));

/**
 * When the sensor's current silence began: its last heartbeat, or the end of a pause after it.
 * During a pause this lies in the future, so the heartbeat never counts as stale.
 */
const silentSince = () => sql<string>`max(${heartbeats.lastSeen}, coalesce(${heartbeats.pausedUntil}, ''))`;

/**
 * The sensor heartbeat, plus whether any outage (false positives included) starts at or after
 * its silence began. If one does, the current silence is already on record: an admin who
 * dismissed it as a false positive (a dead sensor) is not overruled by showing OFF or opening it again.
 */
function heartbeatQuery(db: Db) {
  return db
    .select({
      lastSeen: heartbeats.lastSeen,
      pausedUntil: heartbeats.pausedUntil,
      silentSince: silentSince(),
      onRecord: sql<boolean>`exists (select 1 from ${outages} where ${outages.startTime} >= ${silentSince()})`.mapWith(
        Boolean,
      ),
    })
    .from(heartbeats)
    .where(eq(heartbeats.id, 1))
    .limit(1);
}

type Heartbeat = { lastSeen: string; pausedUntil: string | null; silentSince: string; onRecord: boolean };

/** A plain select, not `findFirst`: relational queries break inside `db.batch` when nothing matches. */
function openOutageQuery(db: Db) {
  return db.select().from(outages).where(isOpen).orderBy(desc(outages.startTime)).limit(1);
}

/** The newest open outage that is not a false positive. */
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

function isPaused({ pausedUntil }: Heartbeat, now: Date): boolean {
  return pausedUntil !== null && Date.parse(pausedUntil) > now.getTime();
}

/** The public shape of an outage row. */
export function summarise(outage: Pick<Outage, 'id' | 'startTime' | 'endTime' | 'isPlanned'>): OutageSummary {
  const { id, startTime, endTime, isPlanned } = outage;
  return { id, startTime, endTime, planned: isPlanned };
}

/** Until a sensor reports, the punch clock is the source of truth: no open outage means ON. */
function powerState(
  openStart: string | undefined,
  heartbeat: Heartbeat | undefined,
  now: Date,
): { status: PowerStatus; since: string | null } {
  if (openStart) return { status: 'OFF', since: openStart };
  // A stale heartbeat is OFF straight away; the cron job opens the record within a minute.
  if (heartbeat && !heartbeat.onRecord && isStale(heartbeat.silentSince, now)) {
    return { status: 'OFF', since: heartbeat.silentSince };
  }
  return { status: 'ON', since: null };
}

/** The D1-backed part of StatusResponse, read in one batch. */
export async function getGridState(db: Db, now: Date) {
  const [[heartbeat], [open], recentRows] = await db.batch([
    heartbeatQuery(db),
    openOutageQuery(db),
    db
      .select()
      .from(outages)
      .where(eq(outages.isFalsePositive, false))
      .orderBy(desc(outages.startTime))
      .limit(RECENT_LIMIT),
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
    // Whether a sensor is reporting now; says nothing about how any outage was recorded.
    monitored: heartbeat !== undefined && !isStale(heartbeat.lastSeen, now) && !isPaused(heartbeat, now),
  };
}

/**
 * Opens a sensor outage when the heartbeat has gone stale and nothing is open yet. Returns whether
 * this call opened one. Safe to call repeatedly and concurrently.
 */
export async function detectOutage(db: Db, now: Date): Promise<boolean> {
  const [[heartbeat], [open]] = await db.batch([heartbeatQuery(db), openOutageQuery(db)]);
  if (open || !heartbeat || heartbeat.onRecord || !isStale(heartbeat.silentSince, now)) return false;
  // The insert re-checks both conditions, in case another request got there first.
  return openOutage(db, heartbeat.silentSince, 'sensor', gte(outages.startTime, heartbeat.silentSince));
}

/**
 * Records a heartbeat and closes every open outage, manual ones included: the sensor seeing power
 * means power is on at the measuring point. If the heartbeat had gone stale but no outage was
 * opened for it (power came back between two cron runs), the gap is recorded as a closed sensor
 * outage, unless the gap is already on record or an open outage (closed here) covers it.
 *
 * `poweredFor` is how many seconds the sensor has had power without a break; 0 vouches only for
 * now. A sensor outage that began since then was only the sensor's connection dropping: it is
 * dismissed as a false positive, and such a gap is not recorded. Other outages end when the power
 * came back.
 */
export async function recordHeartbeat(
  db: Db,
  now: Date,
  poweredFor = 0,
): Promise<{ closed: number; changed: boolean }> {
  const iso = now.toISOString();
  const staleBefore = new Date(now.getTime() - HEARTBEAT_THRESHOLD_MS).toISOString();
  const poweredSince = new Date(Math.max(0, now.getTime() - poweredFor * 1000)).toISOString();
  const anyOpen = isNull(outages.endTime);
  // Insert-select (raw `db.run` cannot be batched): it needs every column, in table order.
  const missedOutage = db
    .select({
      id: sql<number>`null`.as('id'),
      startTime: silentSince().as('start_time'),
      endTime: sql<string>`${poweredSince}`.as('end_time'),
      source: sql<OutageSource>`'sensor'`.as('source'),
      isFalsePositive: sql<boolean>`0`.as('is_false_positive'),
      isPlanned: sql<boolean>`0`.as('is_planned'),
      dismissedBy: sql<null>`null`.as('dismissed_by'),
    })
    .from(heartbeats)
    .where(
      and(
        eq(heartbeats.id, 1),
        lt(silentSince(), staleBefore),
        lt(silentSince(), poweredSince),
        sql`not exists (select 1 from ${outages} where ${outages.startTime} >= ${silentSince()} or ${anyOpen})`,
      ),
    );
  // Before the close below, which would otherwise end these as real outages.
  const dismissed = db
    .update(outages)
    .set({ endTime: iso, isFalsePositive: true, dismissedBy: 'sensor' })
    .where(and(anyOpen, eq(outages.source, 'sensor'), gte(outages.startTime, poweredSince)))
    .returning({ id: outages.id });
  // A manual outage logged while the sensor had power is still the admin's record: it ends now.
  const endTime = sql`case when ${outages.startTime} < ${poweredSince} then ${poweredSince} else ${iso} end`;
  const [missed, , gaps, closed] = await db.batch([
    db.insert(outages).select(missedOutage),
    db
      .insert(heartbeats)
      .values({ id: 1, lastSeen: iso })
      .onConflictDoUpdate({ target: heartbeats.id, set: { lastSeen: iso } }),
    dismissed,
    db.update(outages).set({ endTime }).where(anyOpen).returning({ id: outages.id }),
  ]);
  const count = closed.length + gaps.length;
  return { closed: count, changed: count > 0 || missed.meta.changes > 0 };
}

/**
 * Pauses outage detection until `until`, or with null ends a running pause now, so the silence
 * counts from then. Does nothing before the sensor's first heartbeat. Returns the pause's end.
 */
export async function pauseSensor(db: Db, until: string | null, now: Date): Promise<string | null> {
  const iso = now.toISOString();
  const [row] = await db
    .update(heartbeats)
    .set({ pausedUntil: until ?? iso })
    .where(until ? eq(heartbeats.id, 1) : and(eq(heartbeats.id, 1), gt(heartbeats.pausedUntil, iso)))
    .returning({ pausedUntil: heartbeats.pausedUntil });
  return row?.pausedUntil ?? null;
}

/** Deletes sessions past `expiresAt`; run by HOURLY_CRON, as checkSession deletes only the ones it meets. */
export async function purgeExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString()));
}
