import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import { env } from "../../../lib/env.ts";
import { requirePrincipal } from "../../../lib/policy/principal.ts";
import { descriptorForTool, isCmsToolName } from "../lib/runtime.ts";

type AuditDecisionValues = typeof import("@repo/shared/db").AuditDecision;
const REQUESTED = "requested" satisfies AuditDecisionValues["Requested"];
type AuditStore = import("../../../lib/policy/audit.ts").AuditStore;
let auditStore: Promise<AuditStore> | undefined;

function getAuditStore(): Promise<AuditStore> {
  auditStore ??= import("../../../lib/policy/audit.ts").then(({ createAuditStore }) =>
    createAuditStore({
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
    }),
  );
  return auditStore;
}

export default defineHook({
  events: {
    async "actions.requested"(event, ctx) {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return;
      let audit: AuditStore;
      try {
        audit = await getAuditStore();
      } catch (cause) {
        console.warn("CMS action audit hook unavailable", cause);
        return;
      }
      for (const action of event.data.actions) {
        if (action.kind !== "tool-call" || !isCmsToolName(action.toolName)) continue;
        const descriptor = descriptorForTool(action.toolName);
        const recorded = await audit.record({
          id: `${event.meta.id}:${action.callId}`,
          principal: principal.value,
          delegate: "cms",
          tool: action.toolName,
          risk: descriptor.risk,
          input: action.input,
          decision: REQUESTED,
        });
        if (Result.isError(recorded)) {
          console.warn("CMS action audit hook unavailable", serializeError(recorded.error));
        }
      }
    },
  },
});
