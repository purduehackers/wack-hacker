import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { UserRole } from "../../discord/roles.ts";
import type { AuditDecision, PolicySource, RiskLevel } from "../enums.ts";

/**
 * Append-only audit trail for policy-relevant actions.
 *
 * Redis holds live approval state, which expires minutes after a decision. This
 * table holds the durable history so "who deleted X" stays answerable long
 * after that key evaporates. Writes must never block the action they describe —
 * an audit outage degrades to a counted, logged failure.
 *
 * `inputHash` is a SHA-256 of the *redacted* input and `inputPreview` is a
 * truncated redacted copy. Redaction happens before both, so brute-forcing the
 * hash cannot recover a short secret.
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
