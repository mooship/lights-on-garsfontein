import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const heartbeats = sqliteTable('heartbeats', {
  id: integer('id').primaryKey(),
  lastSeen: text('last_seen').notNull(),
});

export const outages = sqliteTable('outages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  source: text('source', { enum: ['sensor', 'manual'] }).notNull(),
  isFalsePositive: integer('is_false_positive').notNull().default(0),
  isPlanned: integer('is_planned').notNull().default(0),
});

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
  (table) => [uniqueIndex('unique_ip_per_outage_idx').on(table.outageId, table.clientHash)],
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // Hashed session token
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export type Outage = typeof outages.$inferSelect;
