/** Stop uses an existing dispatch route; it must never establish a replacement. */
import type { ExecutionBinding } from "@repo/shared/conversations";
import { Result } from "@repo/shared/result";
import type { CancelRequestPayload, CancelResponse } from "@repo/shared/wire";

import type { AgentClient, AgentError } from "./client.ts";
import type { ExecutionTarget } from "./execution-targets.ts";
import type { ExecutionAddress } from "./routed-client.ts";

// Code-owned release gate. Add a runtime only after active and idle exact-turn
// cancellation pass the installed-engine regression and deployment canary.
// Operator capability declarations cannot add a version to this allowlist.
const VERIFIED_CANCEL_RUNTIMES = new Set<string>();

export function isVerifiedCancelRuntime(runtime: string): boolean {
  return VERIFIED_CANCEL_RUNTIMES.has(runtime);
}

interface CancellationRoute {
  readonly client: Pick<AgentClient, "sendCancel">;
  readonly binding: ExecutionBinding;
  readonly target: ExecutionTarget;
}

/**
 * The resolver and runtime verification are injected here for transport tests;
 * the public routed client always supplies its read-only persisted resolver and
 * the code-owned allowlist above. No operator/environment override exists.
 */
export function createRoutedCancellation(deps: {
  readonly resolve: (
    address: ExecutionAddress & { readonly dispatchId: string },
  ) => Promise<Result<CancellationRoute, AgentError>>;
  readonly isRuntimeVerified: (runtime: string) => boolean;
}) {
  const supports = ({ target, binding }: CancellationRoute): boolean =>
    binding.sessionId !== undefined &&
    deps.isRuntimeVerified(target.identity.runtime) &&
    target.capabilities.includes("exact-turn-cancel-v1");

  return {
    supportsCancel: async (address: ExecutionAddress): Promise<boolean> => {
      if (address.dispatchId === undefined) return false;
      const selected = await deps.resolve({ ...address, dispatchId: address.dispatchId });
      return Result.isOk(selected) && supports(selected.value);
    },
    sendCancel: async (
      payload: CancelRequestPayload,
    ): Promise<Result<CancelResponse, AgentError>> => {
      const selected = await deps.resolve(payload);
      if (Result.isError(selected)) return selected;
      if (!supports(selected.value)) return Result.ok({ ok: true, status: "unsupported" });
      if (selected.value.binding.sessionId !== payload.sessionId)
        return Result.ok({ ok: true, status: "stale" });
      return selected.value.client.sendCancel(payload);
    },
  };
}
