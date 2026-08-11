import { AuditDecision } from "@repo/shared/db";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import { env } from "../env.ts";
import { CORE_TOOL_DESCRIPTORS } from "../lib/descriptors.ts";
import { createAuditStore, requirePrincipal, RiskLevel } from "../lib/policy/index.ts";
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
const audit = createAuditStore({
  url: env.TURSO_DATABASE_URL,
  ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
});

function isAuditedTool(value: string): value is AuditedTool {
  return Object.hasOwn(risks, value);
}

/** A completed action is audited by its outcome shape, never by the model's arguments again. */
interface ToolResultAudit {
  readonly kind: "tool-result";
  readonly failed: boolean | undefined;
}

async function record(
  id: string,
  current: Parameters<typeof requirePrincipal>[0],
  tool: AuditedTool,
  input: JsonValue | ToolResultAudit,
  decision: (typeof AuditDecision)[keyof typeof AuditDecision],
): Promise<void> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return;
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
  }
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
