CREATE TABLE `agent_workspace_operations` (
	`scope` text NOT NULL,
	`generation` text NOT NULL,
	`operation_key` text NOT NULL,
	`owner` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `generation`, `operation_key`),
	CONSTRAINT "agent_workspace_operations_key_check" CHECK(length("agent_workspace_operations"."operation_key") = 64 AND length("agent_workspace_operations"."fingerprint") = 64 AND length("agent_workspace_operations"."owner") = 64),
	CONSTRAINT "agent_workspace_operations_result_check" CHECK(length("agent_workspace_operations"."result") <= 3146752)
);
--> statement-breakpoint
ALTER TABLE `agent_workspaces` ADD `receipt_count` integer DEFAULT 0 NOT NULL CHECK (`receipt_count` BETWEEN 0 AND 512);
--> statement-breakpoint
ALTER TABLE `agent_workspaces` ADD `receipt_bytes` integer DEFAULT 0 NOT NULL CHECK (`receipt_bytes` BETWEEN 0 AND 16777216);
