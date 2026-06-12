import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { UserRole } from "@/lib/ai/constants";
import type { AuditDecision, PolicySource, RiskLevel } from "@/lib/ai/policy/types";

/**
 * Append-only audit trail for policy-relevant actions. Redis keeps the live
 * approval state (TTL'd); this table keeps the durable history so "who
 * deleted X" is answerable after the Redis row evaporates.
 */
export const actionAudit = sqliteTable(
  "action_audit",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").$type<UserRole>().notNull(),
    source: text("source").$type<PolicySource>().notNull(),
    delegate: text("delegate"),
    tool: text("tool").notNull(),
    risk: text("risk").$type<RiskLevel>().notNull(),
    inputHash: text("input_hash").notNull(),
    inputPreview: text("input_preview").notNull(),
    reason: text("reason"),
    decision: text("decision").$type<AuditDecision>().notNull(),
    decidedBy: text("decided_by"),
    traceId: text("trace_id"),
  },
  (table) => [
    index("action_audit_user_at_idx").on(table.userId, table.at),
    index("action_audit_tool_at_idx").on(table.tool, table.at),
  ],
);
