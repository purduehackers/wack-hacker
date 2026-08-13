/**
 * The recovery loop: durable indexes, not HTTP delivery luck, are the truth.
 *
 * One sweep renders every ready dispatch, reconciles every parked delivery, and
 * then re-claims every active queue, in that order. Each step re-checks
 * `isStopped` before doing more work, so shutdown cuts in promptly without
 * abandoning an in-flight Discord write.
 */

import { RecoveryRequired } from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { DeliveryPayload } from "@repo/shared/wire";

import { kick, onParked } from "./queue.ts";
import { applyLatest, reportFailure } from "./render.ts";
import { followSubagent, stopFollowing } from "./subagent-follower.ts";
import type { ConversationFlowDeps, FlowRuntime } from "./types.ts";

const MAX_CONCURRENT_RENDERS = 4;
const SWEEP_DRAIN_TIMEOUT_MS = 15_000;

/** The two ways a delivery ends badly, as the thread and the operator see them. */
const EXPIRED = {
  op: "agent.router.expire-admission",
  operation: "agent delivery",
  detail: "the turn ran past the hard cap without finishing",
  remediation: "send the message again to retry",
} as const;

const UNACKNOWLEDGED = {
  op: "agent.router.recover-admission",
  operation: "agent delivery admission",
  detail: "the admission lease expired before Eve acknowledgement was durable",
  remediation: "reset the conversation before retrying",
} as const;

type BadEnding = typeof EXPIRED | typeof UNACKNOWLEDGED;

/**
 * Report whichever way a bad ending went, and say whether the sweep may continue.
 *
 * `false` means the transition itself failed rather than the delivery — nothing
 * useful is known about this conversation, so the pass moves on to the next.
 */
function announce(
  deps: ConversationFlowDeps,
  continuationKey: string,
  outcome: Result<DeliveryPayload | undefined, KnownError>,
  ending: BadEnding,
): boolean {
  if (Result.isError(outcome)) {
    deps.reporter.captureDefect(outcome.error, {
      op: ending.op,
      attributes: { continuationKey },
    });
    return false;
  }
  if (outcome.value === undefined) return true;
  const error = new RecoveryRequired(ending);
  deps.reporter.emit({
    op: ending.op,
    status: "error",
    errorTag: error._tag,
    errorMessage: error.message,
    attributes: {
      continuationKey,
      messageId: outcome.value.messageId,
      dispatchId: outcome.value.dispatchId,
    },
  });
  return true;
}

/**
 * Make sure a delegated turn is being watched.
 *
 * Started here rather than from a paint, because a paint only happens when a
 * render is published and a delegated turn publishes none — that silence is the
 * whole reason the follower exists.
 *
 * Idempotent per delivery, so revisiting a conversation every sweep costs a
 * lookup rather than a second stream.
 */
async function watchDelegation(deps: ConversationFlowDeps, continuationKey: string): Promise<void> {
  const holder = await deps.store.deliveries.holder(continuationKey);
  if (holder === undefined) return;
  const { dispatchId } = holder;
  const delegation = await deps.store.delegations.current(dispatchId);
  if (Result.isError(delegation)) {
    // Silence here is indistinguishable from "no delegation": the follower never
    // starts, the turn narrates nothing, and its lease is refreshed by nothing.
    deps.reporter.captureDefect(delegation.error, {
      op: "agent.router.decode-delegation",
      attributes: { continuationKey, dispatchId },
    });
    return;
  }
  if (delegation.value === undefined) {
    stopFollowing(dispatchId);
    return;
  }
  followSubagent(deps, dispatchId, continuationKey, delegation.value, async () => {
    await applyLatest(deps, dispatchId);
  });
}

async function recoverActiveQueues(runtime: FlowRuntime): Promise<void> {
  const { deps } = runtime;
  if (runtime.isStopped()) return;
  for (const continuationKey of await deps.store.deliveries.conversations()) {
    if (runtime.isStopped()) break;
    try {
      // Before anything else: a delivery that has held this conversation past the
      // hard cap is given up on, which is what lets a turn that died without
      // parking stop blocking every message behind it.
      announce(deps, continuationKey, await deps.store.delivery.expire(continuationKey), EXPIRED);

      // Recovery needs the dispatch named, because unlike expiry the record
      // outlives the call and the announcement has to say which delivery it is.
      const held = await deps.store.deliveries.read(continuationKey);
      if (held === undefined) {
        await kick(deps, continuationKey);
        continue;
      }
      const recovery = await deps.store.delivery.recover(continuationKey, held.dispatchId);
      if (!announce(deps, continuationKey, recovery, UNACKNOWLEDGED)) continue;

      if (runtime.isStopped()) break;
      await watchDelegation(deps, continuationKey);
      await kick(deps, continuationKey);
    } catch (cause) {
      deps.reporter.captureDefect(cause, {
        op: "agent.router.recover-queue",
        attributes: { continuationKey },
      });
    }
  }
}

async function reconcileParked(runtime: FlowRuntime): Promise<void> {
  const { deps } = runtime;
  const keys = new Set(await deps.store.deliveries.awaitingReconcile());
  for (const continuationKey of runtime.pendingContinuations) keys.add(continuationKey);
  runtime.pendingContinuations.clear();
  for (const continuationKey of keys) {
    // A marker that will not decode reads as absent: one unreadable marker must
    // not stop the sweep reaching the rest, and there is nothing to do with a
    // half-understood one.
    const parked = await deps.store.deliveries.parked(continuationKey);
    if (parked !== undefined) {
      await onParked(runtime, parked);
      continue;
    }
    // Nothing else drops this member: every path that does needs the marker or
    // the record it points at, and both are gone. Left alone it is re-read on
    // every sweep for the life of the deployment.
    await deps.store.delivery.unadvertise(continuationKey);
  }
}

async function renderDispatches(runtime: FlowRuntime): Promise<void> {
  const { deps } = runtime;
  const ready = new Set(await deps.store.renders.pending());
  for (const dispatchId of runtime.pendingDispatches) ready.add(dispatchId);
  runtime.pendingDispatches.clear();
  const dispatches = [...ready];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < dispatches.length && !runtime.isStopped()) {
      const dispatchId = dispatches[cursor++];
      if (dispatchId === undefined) return;
      try {
        while ((await applyLatest(deps, dispatchId)) === "newer" && !runtime.isStopped()) {
          // Drain revisions that arrived while the previous one was painted.
        }
      } catch (error) {
        reportFailure(deps, dispatchId, "agent.render.worker", error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_RENDERS, dispatches.length) }, worker),
  );
}

export async function sweepOnce(runtime: FlowRuntime): Promise<void> {
  // Render first so a durable terminal outcome is present before the queue
  // transition tries to advance past the parked delivery.
  await renderDispatches(runtime);
  await reconcileParked(runtime);
  await recoverActiveQueues(runtime);
}

/** Waits for an in-flight sweep, but never past the shutdown budget. */
export async function awaitSweepDrain(sweepRunning: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SWEEP_DRAIN_TIMEOUT_MS);
    timer.unref();
  });
  await Promise.race([sweepRunning, timeout]);
  if (timer) clearTimeout(timer);
}
