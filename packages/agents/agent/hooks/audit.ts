import { AuditDecision } from "@repo/shared/db/enums";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";
import { z } from "zod";

import { CORE_TOOL_DESCRIPTORS } from "../lib/descriptors.ts";
import { publishAuditEntry } from "../lib/policy/audit-feed.ts";
import { requirePrincipal } from "../lib/policy/principal.ts";
import { getAuditStore } from "../lib/policy/stores.ts";
import { RiskLevel } from "../lib/policy/types.ts";
import type { JsonValue } from "../lib/serialization.ts";

const risks = {
  documentation: CORE_TOOL_DESCRIPTORS.documentation.risk,
  web_search: CORE_TOOL_DESCRIPTORS.web_search.risk,
  resolve_organizer: CORE_TOOL_DESCRIPTORS.resolve_organizer.risk,
  list_audit_log: CORE_TOOL_DESCRIPTORS.list_audit_log.risk,
  schedule_task: RiskLevel.Write,
  cancel_task: RiskLevel.Write,
  list_scheduled_tasks: RiskLevel.Read,
} as const;
type AuditedTool = keyof typeof risks;
function isAuditedTool(value: string): value is AuditedTool {
  return Object.hasOwn(risks, value);
}

/** This hook audits a completed action by its outcome shape, never by the model's arguments again. */
interface ToolResultAudit {
  readonly kind: "tool-result";
  readonly failed: boolean | undefined;
}

/** Distinguishes a result record from a requested input, for the feed only. */
const toolResultAuditSchema = z.strictObject({
  kind: z.literal("tool-result"),
  failed: z.boolean().optional(),
});

const usernameSchema = z.string().trim().min(1).max(64);

async function record(
  id: string,
  current: Parameters<typeof requirePrincipal>[0],
  tool: AuditedTool,
  input: JsonValue | ToolResultAudit,
  decision: AuditDecision,
): Promise<void> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return;
  // Resolved here rather than at module scope: this hook loads on every cold
  // start, and building the store eagerly pulls libSQL into the boot path for
  // turns that never write an audit row.
  let audit: Awaited<ReturnType<typeof getAuditStore>>;
  try {
    audit = await getAuditStore();
  } catch (cause) {
    console.warn("Root action audit unavailable", cause);
    return;
  }
  const outcome = await audit.record({
    id,
    principal: principal.value,
    tool,
    risk: risks[tool],
    input,
    decision,
    decidedBy: principal.value.userId,
  });
  if (Result.isError(outcome)) {
    console.warn("Root action audit unavailable", serializeError(outcome.error));
    return;
  }

  // After the row, never instead of it. The table is the record and this is
  // the feed. A Discord outage must cost the notification only.
  await publishAuditEntry({
    tool,
    risk: risks[tool],
    decision,
    actorId: principal.value.userId,
    actorName: usernameOf(current),
    role: principal.value.role,
    input: describeInput(input),
  });
}

/** The requested input is worth showing. A result's own shape is not. */
function describeInput(input: JsonValue | ToolResultAudit): string | undefined {
  const parsed = toolResultAuditSchema.safeParse(input);
  return parsed.success ? undefined : JSON.stringify(input, undefined, 2);
}

function usernameOf(current: Parameters<typeof requirePrincipal>[0]): string {
  return usernameSchema.safeParse(current?.attributes["username"]).data ?? "unknown";
}

export default defineHook({
  events: {
    async "actions.requested"(event, ctx) {
      for (const action of event.data.actions) {
        if (action.kind !== "tool-call" || !isAuditedTool(action.toolName)) continue;
        await record(
          `${event.meta.id}:${action.callId}`,
          ctx.session.auth.current,
          action.toolName,
          action.input,
          AuditDecision.Requested,
        );
      }
    },
    async "action.result"(event, ctx) {
      const result = event.data.result;
      if (result.kind !== "tool-result" || !isAuditedTool(result.toolName)) return;
      const decision =
        event.data.error?.code === "TOOL_EXECUTION_DENIED"
          ? AuditDecision.Denied
          : result.isError
            ? AuditDecision.Failed
            : AuditDecision.Executed;
      await record(
        `${event.meta.id}:${result.callId}`,
        ctx.session.auth.current,
        result.toolName,
        { kind: result.kind, failed: result.isError },
        decision,
      );
    },
  },
});
