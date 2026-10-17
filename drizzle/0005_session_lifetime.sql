-- Existing sessions have no sign-in time or password fingerprint to backfill, so they are
-- dropped: the admin signs in once after deploy. SQLite adds a NOT NULL column without a
-- default only to an empty table, which the delete guarantees.
DELETE FROM `sessions`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `created_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `password_fingerprint` text NOT NULL;
