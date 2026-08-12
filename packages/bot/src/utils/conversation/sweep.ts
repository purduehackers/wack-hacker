/**
 * The recovery loop: durable indexes, not HTTP delivery luck, are the truth.
 *
 * One sweep renders every ready dispatch, reconciles every parked delivery, and
 * then re-claims every active queue. Order matters — see `sweepOnce`. Each step
 * re-checks `isStopped` before doing more work, so shutdown cuts in promptly
 * without abandoning an in-flight Discord write.
 */

import { RecoveryRequired } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { kick, onParked } from "./queue.ts";
import { applyLatest, reportFailure } from "./render.ts";
import { followSubagent, stopFollowing } from "./subagent-follower.ts";
import type { ConversationFlowDeps, FlowRuntime } from "./types.ts";

const MAX_CONCURRENT_RENDERS = 4;
const SWEEP_DRAIN_TIMEOUT_MS = 15_000;

/**
 * Make sure a delegated turn is being watched.
 *
 * Started here rather than from a paint, because a paint only happens when a
 * render is published and a delegated turn publishes none — that silence is the
 * whole reason the follower exists. Hanging the start off a render meant the
 * delegation had to be announced before the last paint of the turn to be seen
 * at all, and it never was.
 *
 * Idempotent per delivery, so revisiting a conversation every sweep costs a
 * lookup rather than a second stream.
 */
async function watchDelegation(deps: ConversationFlowDeps, continuationKey: string): Promise<void> {
  const holder = await deps.store.queue.holder(continuationKey);
  if (holder?.dispatchId === undefined) return;
  const delegation = await deps.store.subagents.current(holder.dispatchId);
  if (Result.isError(delegation)) return;
  if (delegation.value === undefined) {
    stopFollowing(holder.dispatchId);
    return;
  }
  const dispatchId = holder.dispatchId;
  followSubagent(deps, dispatchId, continuationKey, delegation.value, async () => {
    await applyLatest(deps, dispatchId);
  });
}

async function recoverActiveQueues(runtime: FlowRuntime): Promise<void> {
  const { deps } = runtime;
  if (runtime.isStopped()) return;
  for (const continuationKey of await deps.store.queue.keys()) {
    if (runtime.isStopped()) break;
    try {
      // Before anything else: a delivery that has held this conversation past
      // the hard cap is given up on, which is what lets a turn that died
      // without parking stop blocking every message behind it.
      const expired = await deps.store.queue.expireAdmission(continuationKey);
      if (Result.isError(expired)) {
        deps.reporter.captureDefect(expired.error, {
          op: "agent.router.expire-admission",
          attributes: { continuationKey },
        });
      } else if (expired.value !== undefined) {
        const error = new RecoveryRequired({
          operation: "agent delivery",
          detail: "the turn ran past the hard cap without finishing",
          remediation: "send the message again to retry",
        });
        deps.reporter.emit({
          op: "agent.router.expire-admission",
          status: "error",
          errorTag: error._tag,
          errorMessage: error.message,
          attributes: {
            continuationKey,
            messageId: expired.value.messageId,
            dispatchId: expired.value.dispatchId,
          },
        });
      }

      const recovery = await deps.store.queue.recoverAdmission(continuationKey);
      if (Result.isError(recovery)) {
        deps.reporter.captureDefect(recovery.error, {
          op: "agent.router.recover-admission",
          attributes: { continuationKey },
        });
        continue;
      }
      if (recovery.value !== undefined) {
        const error = new RecoveryRequired({
          operation: "agent delivery admission",
          detail: "the admission lease expired before Eve acknowledgement was durable",
          remediation: "reset the conversation before retrying",
        });
        deps.reporter.emit({
          op: "agent.router.recover-admission",
          status: "error",
          errorTag: error._tag,
          errorMessage: error.message,
          attributes: {
            continuationKey,
            messageId: recovery.value.messageId,
            dispatchId: recovery.value.dispatchId,
          },
        });
      }
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
  const keys = new Set(await deps.store.queue.readyKeys());
  for (const continuationKey of runtime.pendingContinuations) keys.add(continuationKey);
  runtime.pendingContinuations.clear();
  for (const continuationKey of keys) {
    const parked = await deps.store.queue.parked(continuationKey);
    if (Result.isError(parked)) {
      deps.reporter.captureDefect(parked.error, {
        op: "agent.router.recover-marker",
        attributes: { continuationKey },
      });
      continue;
    }
    if (parked.value !== undefined) await onParked(runtime, parked.value);
  }
}

async function renderDispatches(runtime: FlowRuntime): Promise<void> {
  const { deps } = runtime;
  const ready = new Set(await deps.store.render.ready());
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
