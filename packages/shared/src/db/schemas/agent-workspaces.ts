import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    receiptCount: integer("receipt_count").notNull().default(0),
    receiptBytes: integer("receipt_bytes").notNull().default(0),
  },
  (table) => [
    check("agent_workspaces_revision_check", sql`${table.revision} >= 0`),
    check("agent_workspaces_deleted_check", sql`${table.deleted} IN (0, 1)`),
    check("agent_workspaces_snapshot_check", sql`length(${table.snapshot}) <= 6291456`),
    check("agent_workspaces_receipt_count_check", sql`${table.receiptCount} BETWEEN 0 AND 512`),
    check(
      "agent_workspaces_receipt_bytes_check",
      sql`${table.receiptBytes} BETWEEN 0 AND 16777216`,
    ),
  ],
);

/** Immutable results share the workspace generation's lifecycle and bounds. */
export const agentWorkspaceOperations = sqliteTable(
  "agent_workspace_operations",
  {
    scope: text("scope").notNull(),
    generation: text("generation").notNull(),
    operationKey: text("operation_key").notNull(),
    owner: text("owner").notNull(),
    fingerprint: text("fingerprint").notNull(),
    result: text("result").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.generation, table.operationKey] }),
    check(
      "agent_workspace_operations_key_check",
      sql`length(${table.operationKey}) = 64 AND length(${table.fingerprint}) = 64 AND length(${table.owner}) = 64`,
    ),
    check("agent_workspace_operations_result_check", sql`length(${table.result}) <= 3146752`),
  ],
);
