import { AuditDecision } from "@repo/shared/db/enums";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import type { AuditStore } from "./audit.ts";
import { requirePrincipal } from "./principal.ts";
import { getAuditStore } from "./stores.ts";
import type { CapabilityDescriptor } from "./types.ts";

export interface DomainAuditHookAdapter<N extends string> {
  readonly descriptorForTool: (name: N) => CapabilityDescriptor;
  readonly domain: string;
  readonly isToolName: (value: string) => value is N;
  readonly label: string;
  readonly redactInput?: boolean;
}

export function defineDomainAuditHook<N extends string>(adapter: DomainAuditHookAdapter<N>) {
  return defineHook({
    events: {
      async "actions.requested"(event, ctx) {
        const principal = requirePrincipal(ctx.session.auth.current);
        if (Result.isError(principal)) return;
        let audit: AuditStore;
        try {
          audit = await getAuditStore();
        } catch (cause) {
          console.warn(`${adapter.label} action audit hook unavailable`, cause);
          return;
        }
        for (const action of event.data.actions) {
          if (action.kind !== "tool-call" || !adapter.isToolName(action.toolName)) continue;
          const descriptor = adapter.descriptorForTool(action.toolName);
          const recorded = await audit.record({
            id: `${event.meta.id}:${action.callId}`,
            principal: principal.value,
            delegate: adapter.domain,
            tool: action.toolName,
            risk: descriptor.risk,
            input: adapter.redactInput ? { redacted: true } : action.input,
            decision: AuditDecision.Requested,
          });
          if (Result.isError(recorded)) {
            console.warn(
              `${adapter.label} action audit hook unavailable`,
              serializeError(recorded.error),
            );
          }
        }
      },
    },
  });
}
