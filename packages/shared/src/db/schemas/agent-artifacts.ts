import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Blob bodies stay outside the database; this row owns access and delivery. */
export const agentArtifacts = sqliteTable(
  "agent_artifacts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    scopeId: text("scope_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    pathname: text("pathname").notNull(),
    metadata: text("metadata").notNull(),
    visible: integer("visible", { mode: "boolean" }).notNull().default(false),
    retained: integer("retained", { mode: "boolean" }).notNull().default(false),
    publicUrl: text("public_url"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("agent_artifacts_dispatch_idx").on(table.dispatchId)],
);

/** A started write is deliberately never retried automatically after a crash. */
export const bufferOperations = sqliteTable("buffer_operations", {
  id: text("id").primaryKey(),
  operation: text("operation").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull(),
  result: text("result"),
  createdAt: text("created_at").notNull(),
});

export const bufferSnapshots = sqliteTable("buffer_snapshots", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  observedAt: text("observed_at").notNull(),
  status: text("status").notNull(),
  data: text("data").notNull(),
});
