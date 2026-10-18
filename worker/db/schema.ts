import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { OUTAGE_SOURCES } from '../../shared/api';

/**
 * The sensor's last report. One row (id 1), so one sensor per instance: a second sensor needs its
 * own rows here, a sensor id on the heartbeat route and on sensor outages, and its own detection.
 */
export const heartbeats = sqliteTable('heartbeats', {
  id: integer('id').primaryKey(),
  lastSeen: text('last_seen').notNull(),
  /** Until then, silence is expected and opens no outage; null when never paused. */
  pausedUntil: text('paused_until'),
});

export const outages = sqliteTable(
  'outages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** ISO 8601 UTC, like every time in this schema, so text order is time order. */
    startTime: text('start_time').notNull(),
    /** Null while the outage is open. */
    endTime: text('end_time'),
    // Adding a source: extend OUTAGE_SOURCES (shared/api.ts) and its admin label in src/admin/copy.ts.
    // The enum is type-level only (SQLite gets no CHECK constraint), so no migration is needed.
    source: text('source', { enum: OUTAGE_SOURCES }).notNull(),
    isFalsePositive: integer('is_false_positive', { mode: 'boolean' }).notNull().default(sql`0`),
    isPlanned: integer('is_planned', { mode: 'boolean' }).notNull().default(sql`0`),
  },
  (table) => [
    // "Newest first" queries (status, admin list) read only the rows they return.
    index('outages_start_time_idx').on(table.startTime),
    // Open outages (end_time IS NULL) and the stats range scan on end_time.
    index('outages_end_start_idx').on(table.endTime, table.startTime),
  ],
);

export const sessions = sqliteTable('sessions', {
  /** SHA-256 of the cookie's token, so a copy of this table cannot sign anyone in. */
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  /** Sign-in time; the absolute session lifetime counts from here, however often it is renewed. */
  createdAt: text('created_at').notNull(),
  /** Short hash of ADMIN_PASSWORD_HASH at sign-in; a new password signs every session out. */
  passwordFingerprint: text('password_fingerprint').notNull(),
});

export type Outage = typeof outages.$inferSelect;
