CREATE TABLE `still_off_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`client_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `still_off_reports_client_created_idx` ON `still_off_reports` (`client_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `still_off_reports_created_at_idx` ON `still_off_reports` (`created_at`);