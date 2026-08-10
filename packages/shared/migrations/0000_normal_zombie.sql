CREATE TABLE `action_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`delegate` text,
	`tool` text NOT NULL,
	`risk` text NOT NULL,
	`input_hash` text NOT NULL,
	`input_preview` text NOT NULL,
	`reason` text,
	`decision` text NOT NULL,
	`decided_by` text,
	`trace_id` text
);
--> statement-breakpoint
CREATE INDEX `action_audit_user_at_idx` ON `action_audit` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `action_audit_tool_at_idx` ON `action_audit` (`tool`,`at`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
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
	CONSTRAINT "scheduled_tasks_action_type_check" CHECK("scheduled_tasks"."action_type" IN ('agent', 'message')),
	CONSTRAINT "scheduled_tasks_shape_check" CHECK(("scheduled_tasks"."schedule_type" = 'once' AND "scheduled_tasks"."cron" IS NULL AND "scheduled_tasks"."timezone" IS NULL) OR ("scheduled_tasks"."schedule_type" = 'recurring' AND "scheduled_tasks"."cron" IS NOT NULL AND "scheduled_tasks"."timezone" IS NOT NULL)),
	CONSTRAINT "scheduled_tasks_attempt_count_check" CHECK("scheduled_tasks"."attempt_count" >= 0),
	CONSTRAINT "scheduled_tasks_fire_count_check" CHECK("scheduled_tasks"."fire_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_due_idx` ON `scheduled_tasks` (`status`,`available_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_owner_idx` ON `scheduled_tasks` (`owner_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `shopping_cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`asin` text NOT NULL,
	`title` text NOT NULL,
	`price` real NOT NULL,
	`quantity` integer NOT NULL,
	`added_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `shopping_carts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_cart_items_cart_asin_uq` ON `shopping_cart_items` (`cart_id`,`asin`);--> statement-breakpoint
CREATE TABLE `shopping_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
