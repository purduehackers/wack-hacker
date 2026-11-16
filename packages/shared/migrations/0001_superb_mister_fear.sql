CREATE TABLE `agent_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`pathname` text NOT NULL,
	`metadata` text NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`retained` integer DEFAULT false NOT NULL,
	`public_url` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_artifacts_dispatch_idx` ON `agent_artifacts` (`dispatch_id`);--> statement-breakpoint
CREATE TABLE `buffer_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `buffer_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL
);
