import { createClient } from "@libsql/client/http";
import type { actionAudit } from "@repo/shared/db";
import { UserRole } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "../env.ts";
import { redactAuditPreview } from "../lib/json.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { PolicySource, RiskLevel } from "../lib/policy/types.ts";
import { guardToolExecution } from "../lib/serialization.ts";

type AuditDecisionValues = typeof import("@repo/shared/db").AuditDecision;

/** Runtime copy checked exhaustively against the shared durable enum without loading native libSQL. */
const AUDIT_DECISIONS = {
  Requested: "requested",
  Approved: "approved",
  Denied: "denied",
  Timeout: "timeout",
  Executed: "executed",
  Failed: "failed",
  PromptFailed: "prompt_failed",
} as const satisfies AuditDecisionValues;

export const auditLogInputSchema = z.strictObject({
  user_id: z.string().optional().describe("Filter by the acting Discord user ID"),
  tool_name: z.string().optional().describe("Filter by tool name (e.g. 'delete_project')"),
  decision: z
    .enum(AUDIT_DECISIONS)
    .optional()
    .describe("Filter by lifecycle stage (e.g. 'denied', 'executed', 'prompt_failed')"),
  limit: z.int().min(1).max(100).optional().describe("Max rows to return (default 25)"),
});

// `id` stays a bare string: `lib/policy/domain-audit-hook.ts` mints composite
// `<eventId>:<callId>` ids, so a uuid format here would reject most real rows.
const auditRowSchema = z.strictObject({
  id: z.string(),
  at: z.iso.datetime(),
  userId: z.string(),
  role: z.enum(UserRole),
  source: z.enum(PolicySource),
  delegate: z.string().nullable(),
  tool: z.string(),
  risk: z.enum(RiskLevel),
  inputHash: z.hash("sha256"),
  inputPreview: z.string(),
  reason: z.string().nullable(),
  decision: z.enum(AUDIT_DECISIONS),
  decidedBy: z.string().nullable(),
  traceId: z.string().nullable(),
}) satisfies z.ZodType<typeof actionAudit.$inferSelect>;

let auditClient: ReturnType<typeof createClient> | undefined;

function getAuditClient() {
  auditClient ??= createClient({
    url: env.TURSO_DATABASE_URL,
    ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
  });
  return auditClient;
}

function protectAuditRow(row: z.output<typeof auditRowSchema>) {
  return { ...row, inputPreview: redactAuditPreview(row.inputPreview) };
}

export async function queryAuditLog(input: z.output<typeof auditLogInputSchema>) {
  if (env.TURSO_DATABASE_URL.length === 0) {
    throw new UpstreamError({
      service: "Turso",
      status: 503,
      detail: "integration is not configured",
    });
  }

  const conditions: string[] = [];
  const args: string[] = [];
  if (input.user_id) {
    conditions.push("user_id = ?");
    args.push(input.user_id);
  }
  if (input.tool_name) {
    conditions.push("tool = ?");
    args.push(input.tool_name);
  }
  if (input.decision) {
    conditions.push("decision = ?");
    args.push(input.decision);
  }

  const result = await getAuditClient().execute({
    sql: `SELECT
      id,
      at,
      user_id AS userId,
      role,
      source,
      delegate,
      tool,
      risk,
      input_hash AS inputHash,
      input_preview AS inputPreview,
      reason,
      decision,
      decided_by AS decidedBy,
      trace_id AS traceId
    FROM action_audit
    ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
    ORDER BY at DESC
    LIMIT ?`,
    args: [...args, input.limit ?? 25],
  });

  const candidates = result.rows.map((row) => ({
    id: row["id"],
    at: row["at"],
    userId: row["userId"],
    role: row["role"],
    source: row["source"],
    delegate: row["delegate"],
    tool: row["tool"],
    risk: row["risk"],
    inputHash: row["inputHash"],
    inputPreview: row["inputPreview"],
    reason: row["reason"],
    decision: row["decision"],
    decidedBy: row["decidedBy"],
    traceId: row["traceId"],
  }));
  const parsed = z.array(auditRowSchema).safeParse(candidates);
  if (!parsed.success) {
    throw new UpstreamError({
      service: "Turso",
      status: 502,
      detail: `audit rows were invalid: ${z.prettifyError(parsed.error)}`,
    });
  }
  if (parsed.data.length === 0) return "No audit rows match.";
  return parsed.data.map(protectAuditRow);
}

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("list_audit_log", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Read the durable action audit log: policy-gated tool executions, approval requests, and who approved or denied them. Rows are returned newest first. Use this to answer questions like 'who deleted X' or 'what destructive actions ran yesterday'.",
        inputSchema: auditLogInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("list_audit_log", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await queryAuditLog(input);
            } catch (cause) {
              return coreToolFailure("Turso", cause);
            }
          });
        },
      });
    },
  },
});
