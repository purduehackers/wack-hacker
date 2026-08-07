import { AuditDecision } from "@repo/shared/db";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import { env } from "../../../lib/env.ts";
import { createAuditStore, requirePrincipal } from "../../../lib/policy/index.ts";
import { descriptorForTool, isFigmaToolName } from "../lib/descriptors.ts";

const audit = createAuditStore({
  url: env.TURSO_DATABASE_URL,
  ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
});

export default defineHook({
  events: {
    async "actions.requested"(event, ctx) {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return;
      for (const action of event.data.actions) {
        if (action.kind !== "tool-call" || !isFigmaToolName(action.toolName)) continue;
        const descriptor = descriptorForTool(action.toolName);
        const recorded = await audit.record({
          id: `${event.meta.id}:${action.callId}`,
          principal: principal.value,
          delegate: "figma",
          tool: action.toolName,
          risk: descriptor.risk,
          input: action.input,
          decision: AuditDecision.Requested,
        });
        if (Result.isError(recorded)) {
          console.warn("Figma action audit hook unavailable", serializeError(recorded.error));
        }
      }
    },
  },
});
