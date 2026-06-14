import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/lib/db/index.ts";
import { actionAudit } from "@/lib/db/schemas/action-audit.ts";

import { defineTool } from "../_shared/define-tool.ts";

const DECISIONS = ["requested", "approved", "denied", "timeout", "executed", "failed"] as const;

export const list_audit_log = defineTool({
  name: "list_audit_log",
  domain: "core",
  description:
    "Read the durable action audit log: policy-gated tool executions, approval requests, and " +
    "who approved or denied them. Rows are returned newest first. Use this to answer questions " +
    'like "who deleted X" or "what destructive actions ran yesterday".',
  access: { risk: "read", minRole: "admin" },
  input: z.object({
    user_id: z.string().optional().describe("Filter by the acting Discord user ID"),
    tool_name: z.string().optional().describe("Filter by tool name (e.g. 'delete_project')"),
    decision: z
      .enum(DECISIONS)
      .optional()
      .describe("Filter by lifecycle stage (e.g. 'denied', 'executed')"),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)"),
  }),
  execute: async ({ user_id, tool_name, decision, limit }) => {
    const conditions: SQL[] = [];
    if (user_id) conditions.push(eq(actionAudit.userId, user_id));
    if (tool_name) conditions.push(eq(actionAudit.tool, tool_name));
    if (decision) conditions.push(eq(actionAudit.decision, decision));

    const rows = await getDb()
      .select()
      .from(actionAudit)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(actionAudit.at))
      .limit(limit ?? 25);

    if (rows.length === 0) return "No audit rows match.";
    return JSON.stringify(rows);
  },
});
