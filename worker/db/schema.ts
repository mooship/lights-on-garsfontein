import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The sensor's last report. One row (id 1), so one sensor per instance: a second sensor needs its
 * own rows here, a sensor id on the heartbeat route and on sensor outages, and its own detection.
 */
export const heartbeats = sqliteTable('heartbeats', {
  id: integer('id').primaryKey(),
  lastSeen: text('last_seen').notNull(),
});

export const outages = sqliteTable(
  'outages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startTime: text('start_time').notNull(),
    endTime: text('end_time'),
    // Adding a source: extend this enum, `OutageSource` in shared/api.ts and the admin `source`
    // labels in the dictionaries together, then run `npm run db:generate` and commit any
    // migration. In SQLite the enum is type-level only (no CHECK constraint), so existing rows and
    // the column need no change.
    source: text('source', { enum: ['sensor', 'manual'] }).notNull(),
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

export const outageConfirmations = sqliteTable(
  'outage_confirmations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    outageId: integer('outage_id')
      .notNull()
      .references(() => outages.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    clientHash: text('client_hash').notNull(),
  },
  (table) => [
    uniqueIndex('unique_ip_per_outage_idx').on(table.outageId, table.clientHash),
    // The hourly fingerprint purge filters on created_at.
    index('outage_confirmations_created_at_idx').on(table.createdAt),
  ],
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // Hashed session token
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  /** Sign-in time: however much it is used, a session ends at the absolute maximum after this. */
  createdAt: text('created_at').notNull(),
  /** Short hash of ADMIN_PASSWORD_HASH at sign-in; a new password signs every session out. */
  passwordFingerprint: text('password_fingerprint').notNull(),
});

export type Outage = typeof outages.$inferSelect;
