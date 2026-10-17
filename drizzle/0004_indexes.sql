CREATE INDEX `outage_confirmations_created_at_idx` ON `outage_confirmations` (`created_at`);--> statement-breakpoint
CREATE INDEX `outages_end_start_idx` ON `outages` (`end_time`,`start_time`);