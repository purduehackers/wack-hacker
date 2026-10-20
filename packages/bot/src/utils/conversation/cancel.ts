/** Exact-task stop commands reuse the conversation store and recovery timer. */
import type { CancellationStatus, ConversationStore } from "@repo/shared/conversations";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import type { CancelRequestPayload } from "@repo/shared/wire";

import type { AgentClient } from "../../agent/client.ts";

interface CancellationDeps {
  readonly eve: Pick<AgentClient, "sendCancel" | "supportsCancel">;
  readonly store: Pick<ConversationStore, "cancellations">;
  readonly reporter: Reporter;
}

export async function deliverCancellation(
  deps: CancellationDeps,
  payload: CancelRequestPayload,
): Promise<CancellationStatus> {
  const result = await deps.eve.sendCancel(payload);
  if (Result.isError(result)) {
    deps.reporter.emit({
      op: "agent.cancel.delivery",
      status: "error",
      errorTag: result.error._tag,
      errorMessage: result.error.message,
      attributes: { dispatchId: payload.dispatchId },
    });
    // Never guess whether Eve accepted a lost HTTP response. The exact command
    // stays durable and the next sweep retries the same session and turn only.
    return "pending";
  }
  const { status } = result.value;
  if (status !== "busy") await deps.store.cancellations.acknowledge(payload, status);
  return status;
}

export async function requestCancellation(
  deps: CancellationDeps,
  payload: CancelRequestPayload,
): Promise<CancellationStatus> {
  if (!(await deps.eve.supportsCancel(payload))) return "unsupported";
  const status = await deps.store.cancellations.request(payload);
  if (status !== "pending") return status;
  // Concurrent clicks keep the first authorised command, including its original
  // interaction id. Never rewrite its identity with a later delivery.
  const saved = await deps.store.cancellations.read(payload.dispatchId);
  if (saved?.request === undefined) return "stale";
  return deliverCancellation(deps, saved.request.payload);
}

async function recoverCancellation(deps: CancellationDeps, dispatchId: string): Promise<void> {
  try {
    const control = await deps.store.cancellations.read(dispatchId);
    if (control?.request?.status !== "pending") {
      await deps.store.cancellations.forgetPending(dispatchId);
      return;
    }
    await deliverCancellation(deps, control.request.payload);
  } catch (cause) {
    deps.reporter.captureDefect(cause, {
      op: "agent.cancel.recover",
      attributes: { dispatchId },
    });
  }
}

const MAX_CONCURRENT_CANCELLATIONS = 2;

/**
 * Cancellation delivery cannot hold answer rendering or queue reconciliation.
 * Each scan admits only free worker slots and never waits for HTTP. A hung
 * command occupies one slot, without preventing later scans using the other.
 * The durable index retains failures for the next regular wake, not a hot loop.
 */
export function createCancellationRecovery(deps: CancellationDeps, isStopped: () => boolean) {
  const active = new Map<string, Promise<void>>();
  let scanning: Promise<void> | undefined;
  let cursor = 0;

  async function scan(): Promise<void> {
    const dispatches = (await deps.store.cancellations.pending()).sort();
    const start = cursor;
    for (let checked = 0; checked < dispatches.length; checked += 1) {
      if (isStopped() || active.size >= MAX_CONCURRENT_CANCELLATIONS) break;
      const index = (start + checked) % dispatches.length;
      cursor = (index + 1) % dispatches.length;
      const dispatchId = dispatches[index];
      if (dispatchId === undefined) continue;
      if (active.has(dispatchId)) continue;
      const delivery = recoverCancellation(deps, dispatchId).finally(() => {
        active.delete(dispatchId);
      });
      active.set(dispatchId, delivery);
    }
  }

  return {
    wake: (): void => {
      if (isStopped() || scanning !== undefined) return;
      scanning = scan()
        .catch((cause: unknown) => {
          deps.reporter.captureDefect(cause, { op: "agent.cancel.scan" });
        })
        .finally(() => {
          scanning = undefined;
        });
    },
    /** Called after isStopped becomes true, inside the shared shutdown budget. */
    drain: async (): Promise<void> => {
      await scanning;
      await Promise.all(active.values());
    },
  };
}
