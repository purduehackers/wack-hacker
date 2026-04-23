CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`description` text NOT NULL,
	`schedule_type` text NOT NULL,
	`run_at` text,
	`cron` text,
	`timezone` text,
	`action` text NOT NULL,
	`member_roles` text,
	`status` text DEFAULT 'active' NOT NULL,
	`next_run_at` text,
	`queue_message_id` text,
	`last_fired_at` text,
	`fire_count` integer DEFAULT 0 NOT NULL,
	`max_drift_ms` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_user_status_idx` ON `scheduled_tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_status_next_run_idx` ON `scheduled_tasks` (`status`,`next_run_at`);