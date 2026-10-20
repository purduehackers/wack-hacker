import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Bounded virtual files, independent of the app host or Workflow checkpoints. */
export const agentWorkspaces = sqliteTable(
  "agent_workspaces",
  {
    scope: text("scope").primaryKey(),
    generation: text("generation").notNull(),
    revision: integer("revision").notNull(),
    commitId: text("commit_id").notNull(),
    snapshot: text("snapshot").notNull(),
    deleted: integer("deleted").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("agent_workspaces_revision_check", sql`${table.revision} >= 0`),
    check("agent_workspaces_deleted_check", sql`${table.deleted} IN (0, 1)`),
    check("agent_workspaces_snapshot_check", sql`length(${table.snapshot}) <= 6291456`),
  ],
);
