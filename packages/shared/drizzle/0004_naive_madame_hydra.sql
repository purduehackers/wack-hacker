PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`description` text NOT NULL,
	`action_type` text DEFAULT 'agent' NOT NULL,
	`prompt` text NOT NULL,
	`member_roles` text,
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
	CONSTRAINT "scheduled_tasks_action_type_check" CHECK("__new_scheduled_tasks"."action_type" IN ('agent', 'message')),
	CONSTRAINT "scheduled_tasks_shape_check" CHECK(("__new_scheduled_tasks"."schedule_type" = 'once' AND "__new_scheduled_tasks"."cron" IS NULL AND "__new_scheduled_tasks"."timezone" IS NULL) OR ("__new_scheduled_tasks"."schedule_type" = 'recurring' AND "__new_scheduled_tasks"."cron" IS NOT NULL AND "__new_scheduled_tasks"."timezone" IS NOT NULL)),
	CONSTRAINT "scheduled_tasks_attempt_count_check" CHECK("__new_scheduled_tasks"."attempt_count" >= 0),
	CONSTRAINT "scheduled_tasks_fire_count_check" CHECK("__new_scheduled_tasks"."fire_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_tasks`(
	"id", "owner_id", "channel_id", "description", "action_type", "prompt",
	"member_roles", "schedule_type", "cron", "timezone", "status", "next_run_at",
	"available_at", "lease_token", "lease_expires_at", "attempt_count", "last_error",
	"last_dispatched_at", "fire_count", "created_at", "updated_at"
)
SELECT
	"id",
	"owner_id",
	CASE
		WHEN json_type("prompt", '$.action') = 'object' THEN json_extract("prompt", '$.action.channelId')
		ELSE json_extract("prompt", '$.channelId')
	END,
	"description",
	CASE
		WHEN json_type("prompt", '$.action') = 'object' THEN json_extract("prompt", '$.action.type')
		ELSE json_extract("prompt", '$.type')
	END,
	CASE
		WHEN json_type("prompt", '$.action') = 'object' AND json_extract("prompt", '$.action.type') = 'message'
			THEN json_extract("prompt", '$.action.content')
		WHEN json_type("prompt", '$.action') = 'object'
			THEN json_extract("prompt", '$.action.prompt')
		WHEN json_extract("prompt", '$.type') = 'message'
			THEN json_extract("prompt", '$.content')
		ELSE json_extract("prompt", '$.prompt')
	END,
	CASE
		WHEN json_type("prompt", '$.action') = 'object' AND json_type("prompt", '$.memberRoles') = 'array'
			THEN json_extract("prompt", '$.memberRoles')
		ELSE NULL
	END,
	"schedule_type", "cron", "timezone", "status", "next_run_at", "available_at",
	"lease_token", "lease_expires_at", "attempt_count", "last_error",
	"last_dispatched_at", "fire_count", "created_at", "updated_at"
FROM `scheduled_tasks`;--> statement-breakpoint
DROP TABLE `scheduled_tasks`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_tasks` RENAME TO `scheduled_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scheduled_tasks_due_idx` ON `scheduled_tasks` (`status`,`available_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_owner_idx` ON `scheduled_tasks` (`owner_id`,`status`,`created_at`);