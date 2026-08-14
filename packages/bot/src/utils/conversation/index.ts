/**
 * @fileoverview The bot's single reconciler for queueing, rendering, HITL,
 * reset, and schedules.
 *
 * This file owns only the mutable lifecycle state — started/stopped, the two
 * pending sets, and the sweep scheduler. The work itself lives beside it:
 * `render.ts` paints a dispatch, `queue.ts` holds the inbound operations, and
 * `sweep.ts` is the recovery loop. They receive that state explicitly through
 * `FlowRuntime` rather than closing over it, which is what keeps them separable.
 */

import type { Result } from "@repo/shared/result";
import type { MessagePayload } from "@repo/shared/wire";

import type { AgentError } from "../../agent/client.ts";
import { admitScheduledFire, answerHitl, resetAndKick, submitMessage } from "./queue.ts";
import { stopAllFollowers } from "./subagent-follower.ts";
import { awaitSweepDrain, sweepOnce } from "./sweep.ts";
import type { ConversationFlow, ConversationFlowDeps, FlowRuntime } from "./types.ts";

export type {
  ConversationAnswer,
  ConversationAnswerResult,
  ConversationFlow,
  ConversationFlowDeps,
  ConversationWake,
} from "./types.ts";

const RECOVERY_INTERVAL_MS = 15_000;

/**
 * Builds the reconciler around one shared mutable state. Sweeps coalesce:
 * `wake` marks work pending and schedules at most one drain, so a burst of
 * events costs one pass. Call `start` before expecting any sweep to run.
 */
export function createConversationFlow(deps: ConversationFlowDeps): ConversationFlow {
  const pendingDispatches = new Set<string>();
  const pendingContinuations = new Set<string>();
  let stopped = false;
  let started = false;
  let sweepRequested = false;
  let sweepScheduled = false;
  let sweepRunning: Promise<void> | undefined;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  const runtime: FlowRuntime = {
    deps,
    pendingDispatches,
    pendingContinuations,
    isStopped: () => stopped,
  };

  function submit(payload: MessagePayload): Promise<Result<void, AgentError>> {
    return submitMessage(runtime, payload);
  }

  async function drainSweeps(): Promise<void> {
    if (sweepRunning) return sweepRunning;
    sweepRunning = (async () => {
      do {
        sweepRequested = false;
        await sweepOnce(runtime);
      } while (sweepRequested && !stopped);
    })().finally(() => {
      sweepRunning = undefined;
      if (sweepRequested && !stopped) scheduleSweep();
    });
    return sweepRunning;
  }

  function scheduleSweep(): void {
    sweepRequested = true;
    if (!started || stopped || sweepScheduled) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      void drainSweeps().catch((cause: unknown) => {
        deps.reporter.captureDefect(cause, { op: "agent.router.recovery" });
      });
    });
  }

  return {
    submit,
    reset: (payload) => resetAndKick(runtime, payload),
    answer: (answer) => answerHitl(deps, answer),
    admitSchedule: (payload) => admitScheduledFire(deps, payload, submit),
    wake: (hint = {}) => {
      if (stopped) return;
      if (hint.dispatchId) pendingDispatches.add(hint.dispatchId);
      if (hint.continuationKey) pendingContinuations.add(hint.continuationKey);
      scheduleSweep();
    },
    sweep: async () => {
      if (stopped) return;
      sweepRequested = true;
      await drainSweeps();
    },
    start: async () => {
      if (started || stopped) return;
      started = true;
      sweepRequested = true;
      await drainSweeps();
      if (stopped) return;
      recoveryTimer = setInterval(scheduleSweep, RECOVERY_INTERVAL_MS);
      recoveryTimer.unref();
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      // Child streams are held open by this process. Nothing else will drop
      // them, and a half-read stream would keep a lease alive past shutdown.
      stopAllFollowers();
      if (recoveryTimer) clearInterval(recoveryTimer);
      if (!sweepRunning) return;
      await awaitSweepDrain(sweepRunning);
    },
  };
}
