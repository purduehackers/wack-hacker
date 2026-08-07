import { AuditDecision } from "@repo/shared/db";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import { CORE_TOOL_DESCRIPTORS } from "../../../lib/core/descriptors.ts";
import { env } from "../../../lib/env.ts";
import { createAuditStore, requirePrincipal } from "../../../lib/policy/index.ts";

const audit = createAuditStore({
  url: env.TURSO_DATABASE_URL,
  ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
});

export default defineHook({
  events: {
    async "action.result"(event, ctx) {
      const result = event.data.result;
      if (result.kind !== "tool-result" || result.toolName !== "documentation") return;
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return;
      const recorded = await audit.record({
        id: `${event.meta.id}:${result.callId}`,
        principal: principal.value,
        delegate: "docs",
        tool: result.toolName,
        risk: CORE_TOOL_DESCRIPTORS.documentation.risk,
        input: { kind: result.kind, failed: result.isError ?? false },
        decision: result.isError ? AuditDecision.Failed : AuditDecision.Executed,
      });
      if (Result.isError(recorded)) {
        console.warn("Documentation result audit unavailable", serializeError(recorded.error));
      }
    },
    async "actions.requested"(event, ctx) {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return;
      for (const action of event.data.actions) {
        if (action.kind !== "tool-call" || action.toolName !== "documentation") continue;
        const recorded = await audit.record({
          id: `${event.meta.id}:${action.callId}`,
          principal: principal.value,
          delegate: "docs",
          tool: action.toolName,
          risk: CORE_TOOL_DESCRIPTORS.documentation.risk,
          input: action.input,
          decision: AuditDecision.Requested,
        });
        if (Result.isError(recorded)) {
          console.warn("Documentation action audit unavailable", serializeError(recorded.error));
        }
      }
    },
  },
});
