ALTER TABLE `scheduled_tasks` RENAME TO `__scheduled_tasks_v2_legacy`;
--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`description` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule_type` text NOT NULL,
	`cron` text,
	`timezone` text,
	`status` text DEFAULT 'active' NOT NULL,
	`next_run_at` text NOT NULL,
	`available_at` text NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_dispatched_at` text,
	`fire_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "scheduled_tasks_shape_check" CHECK(("scheduled_tasks"."schedule_type" = 'once' AND "scheduled_tasks"."cron" IS NULL AND "scheduled_tasks"."timezone" IS NULL) OR ("scheduled_tasks"."schedule_type" = 'recurring' AND "scheduled_tasks"."cron" IS NOT NULL AND "scheduled_tasks"."timezone" IS NOT NULL)),
	CONSTRAINT "scheduled_tasks_attempt_count_check" CHECK("scheduled_tasks"."attempt_count" >= 0),
	CONSTRAINT "scheduled_tasks_fire_count_check" CHECK("scheduled_tasks"."fire_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `scheduled_tasks` (
	`id`,
	`owner_id`,
	`channel_id`,
	`description`,
	`prompt`,
	`schedule_type`,
	`cron`,
	`timezone`,
	`status`,
	`next_run_at`,
	`available_at`,
	`last_dispatched_at`,
	`fire_count`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`user_id`,
	`channel_id`,
	`description`,
	`action`,
	CASE WHEN `schedule_type` = 'cron' THEN 'recurring' ELSE `schedule_type` END,
	`cron`,
	`timezone`,
	`status`,
	COALESCE(`next_run_at`, `run_at`, `last_fired_at`, `created_at`),
	COALESCE(`next_run_at`, `run_at`, `last_fired_at`, `created_at`),
	`last_fired_at`,
	`fire_count`,
	`created_at`,
	`updated_at`
FROM `__scheduled_tasks_v2_legacy`;
--> statement-breakpoint
DROP TABLE `__scheduled_tasks_v2_legacy`;
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_due_idx` ON `scheduled_tasks` (`status`,`available_at`,`lease_expires_at`);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_owner_idx` ON `scheduled_tasks` (`owner_id`,`status`,`created_at`);
