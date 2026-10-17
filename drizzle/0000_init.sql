CREATE TABLE `heartbeats` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_seen` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outage_confirmations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`outage_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`client_hash` text NOT NULL,
	FOREIGN KEY (`outage_id`) REFERENCES `outages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_ip_per_outage_idx` ON `outage_confirmations` (`outage_id`,`client_hash`);--> statement-breakpoint
CREATE TABLE `outages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text,
	`source` text NOT NULL,
	`is_false_positive` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL
);
