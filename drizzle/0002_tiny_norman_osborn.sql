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
CREATE INDEX `action_audit_tool_at_idx` ON `action_audit` (`tool`,`at`);