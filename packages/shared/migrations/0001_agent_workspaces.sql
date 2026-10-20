CREATE TABLE `agent_workspaces` (
	`scope` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`revision` integer NOT NULL,
	`commit_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "agent_workspaces_revision_check" CHECK("agent_workspaces"."revision" >= 0),
	CONSTRAINT "agent_workspaces_deleted_check" CHECK("agent_workspaces"."deleted" IN (0, 1)),
	CONSTRAINT "agent_workspaces_snapshot_check" CHECK(length("agent_workspaces"."snapshot") <= 6291456)
);
