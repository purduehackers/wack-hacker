import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import type { AuditStore } from "./audit.ts";
import { requirePrincipal } from "./principal.ts";
import { getAuditStore } from "./stores.ts";
import type { CapabilityDescriptor } from "./types.ts";

type AuditDecisionValues = typeof import("@repo/shared/db").AuditDecision;
const REQUESTED = "requested" satisfies AuditDecisionValues["Requested"];

export interface DomainAuditHookAdapter<N extends string> {
  readonly descriptorForTool: (name: N) => CapabilityDescriptor;
  readonly domain: string;
  readonly isToolName: (value: string) => value is N;
  readonly label: string;
}

export function defineDomainAuditHook<N extends string>(
  adapter: DomainAuditHookAdapter<N>,
  loadAuditStore: () => Promise<Pick<AuditStore, "record">> = getAuditStore,
) {
  return defineHook({
    events: {
      async "actions.requested"(event, ctx) {
        const principal = requirePrincipal(ctx.session.auth.current);
        if (Result.isError(principal)) return;
        let audit: Pick<AuditStore, "record">;
        try {
          audit = await loadAuditStore();
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
            input: action.input,
            decision: REQUESTED,
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
