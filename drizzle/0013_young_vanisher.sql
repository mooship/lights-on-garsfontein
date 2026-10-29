ALTER TABLE `outages` ADD `telegram_off_alert_at` text;--> statement-breakpoint
ALTER TABLE `outages` ADD `telegram_on_alert_at` text;--> statement-breakpoint
CREATE INDEX `outages_telegram_alert_pending_idx` ON `outages` (`telegram_off_alert_at`) WHERE "outages"."telegram_on_alert_at" is null;