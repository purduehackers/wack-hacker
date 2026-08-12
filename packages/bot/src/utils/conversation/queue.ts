/**
 * The inbound operations: everything a caller asks the flow to do.
 *
 * Each one moves the durable queue forward exactly one step and then, where a
 * delivery slot may have opened, calls `kick` to claim the next item. Nothing
 * here loops — the sweep owns repetition.
 */

import { tagOf, Transient } from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type {
  MessagePayload,
  ParkedPayload,
  ResetPayload,
  ScheduledFirePayload,
} from "@repo/shared/wire";

import type { AgentError } from "../../agent/client.ts";
import { reportPendingRender } from "./render.ts";
import type {
  ConversationAnswer,
  ConversationAnswerResult,
  ConversationFlow,
  ConversationFlowDeps,
  FlowRuntime,
} from "./types.ts";

export async function kick(
  deps: ConversationFlowDeps,
  continuationKey: string,
): Promise<AgentError | undefined> {
  const next = await deps.store.queue.claim(continuationKey);
  if (Result.isError(next)) {
    deps.reporter.captureDefect(next.error, {
      op: "agent.router.claim",
      attributes: { continuationKey },
    });
    return;
  }

  const claimed = next.value;
  if (claimed === undefined) return;
  const sent = await deps.eve.sendMessage(claimed.payload);
  if (Result.isOk(sent)) {
    // The Eve confirmation and this acknowledgement cover different crash
    // windows. A fast park can consume the claim before this CAS arrives.
    await deps.store.queue.confirm(continuationKey, claimed.claimToken, sent.value.sessionId);
    return;
  }

  deps.reporter.emit({
    op: "agent.router.send",
    status: "error",
    errorTag: tagOf(sent.error),
    errorMessage: sent.error.message,
    attributes: {
      continuationKey,
      messageId: claimed.payload.messageId,
      dispatchId: claimed.payload.dispatchId,
    },
  });
  return sent.error;
}

/**
 * Interrupt the turn holding this conversation, if one is.
 *
 * Someone who types while the agent is working is correcting it, not waiting in
 * line. Cancelling happens agent-side; this only tells it to. Failures are
 * reported and swallowed — the message stays queued either way, and the hard
 * cap eventually releases the conversation even if the agent is unreachable.
 */
async function steerHolder(deps: ConversationFlowDeps, continuationKey: string): Promise<void> {
  const sessionId = await deps.store.queue.holder(continuationKey);
  if (sessionId === undefined) return;
  const steered = await deps.eve.sendSteer({ continuationKey });
  if (Result.isOk(steered)) return;
  deps.reporter.emit({
    op: "agent.router.steer",
    status: "error",
    errorTag: tagOf(steered.error),
    errorMessage: steered.error.message,
    attributes: { continuationKey, sessionId },
  });
}

export async function submitMessage(
  runtime: FlowRuntime,
  payload: MessagePayload,
): Promise<Result<void, AgentError>> {
  const { deps } = runtime;
  const submitted = await Result.tryPromise({
    try: async () => {
      await deps.store.queue.enqueue(payload);
      if (runtime.isStopped()) return undefined;
      const kicked = await kick(deps, payload.continuationKey);
      // `kick` returns without claiming when a turn already holds this
      // conversation. That is the case this exists for: the message is durable
      // in the queue, and interrupting the turn is what lets the queue move.
      await steerHolder(deps, payload.continuationKey);
      return kicked;
    },
    catch: (cause) =>
      new Transient({
        operation: "agent.router.submit",
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (Result.isError(submitted)) return submitted;
  return submitted.value === undefined ? Result.ok(undefined) : Result.err(submitted.value);
}

async function resetConversation(
  deps: ConversationFlowDeps,
  payload: ResetPayload,
): Promise<Result<void, KnownError>> {
  const prepared = await Result.tryPromise({
    try: () => deps.store.queue.beginReset(payload.continuationKey),
    catch: (cause) =>
      new Transient({
        operation: "agent.router.begin-reset",
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (Result.isError(prepared)) return prepared;

  const resetId = prepared.value;
  const reset = await deps.eve.sendReset({ ...payload, resetId });
  // An ambiguous remote result keeps the barrier installed. A later reset
  // reuses the same id and safely finishes or retries the cutover.
  if (Result.isError(reset)) return reset;

  const committed = await Result.tryPromise({
    try: () => deps.store.queue.commitReset(payload.continuationKey, resetId),
    catch: (cause) =>
      new Transient({
        operation: "agent.router.commit-reset",
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (Result.isError(committed)) return committed;
  return committed.value
    ? Result.ok(undefined)
    : Result.err(
        new Transient({
          operation: "agent.router.commit-reset",
          detail: "reset cutover ownership was lost",
        }),
      );
}

export async function resetAndKick(
  runtime: FlowRuntime,
  payload: ResetPayload,
): Promise<Result<void, KnownError>> {
  const reset = await resetConversation(runtime.deps, payload);
  if (Result.isOk(reset) && !runtime.isStopped()) {
    await kick(runtime.deps, payload.continuationKey);
  }
  return reset;
}

export async function answerHitl(
  deps: ConversationFlowDeps,
  { claim, payload }: ConversationAnswer,
): Promise<ConversationAnswerResult> {
  const claimed = await deps.store.hitl.claim(claim);
  if (claimed !== "acquired") return { status: claimed };
  const sent = await deps.eve.sendInteraction(payload);
  if (Result.isError(sent)) return { status: "failed", error: sent.error };
  const completed = await deps.store.hitl.complete(
    claim.dispatchId,
    claim.revision,
    claim.interactionId,
  );
  if (!completed) {
    deps.reporter.captureDefect(new Error("accepted HITL claim could not be completed"), {
      op: "agent.hitl.complete",
      attributes: { dispatchId: claim.dispatchId, interactionId: claim.interactionId },
    });
  }
  return { status: "accepted" };
}

export async function admitScheduledFire(
  deps: ConversationFlowDeps,
  payload: ScheduledFirePayload,
  submit: ConversationFlow["submit"],
): Promise<void> {
  const claimToken = crypto.randomUUID();
  const claim = await deps.store.scheduledFires.claim(payload, claimToken);
  if (claim === "accepted") return;
  if (claim === "busy") throw new Error("scheduled occurrence is already being admitted");
  try {
    await deps.schedules.admit(payload, submit);
    if (!(await deps.store.scheduledFires.complete(payload, claimToken))) {
      throw new Error("scheduled occurrence admission receipt ownership was lost");
    }
  } catch (cause) {
    await deps.store.scheduledFires
      .release(payload.occurrenceId, claimToken)
      .catch((releaseCause: unknown) =>
        console.warn("could not release scheduled occurrence claim", releaseCause),
      );
    throw cause;
  }
}

export async function onParked(runtime: FlowRuntime, payload: ParkedPayload): Promise<void> {
  const { deps } = runtime;
  if (runtime.isStopped()) return;
  const outcome = await deps.store.render.outcome(payload.dispatchId);
  if (outcome === undefined) {
    runtime.pendingDispatches.add(payload.dispatchId);
    reportPendingRender(deps, payload);
    return;
  }
  if (runtime.isStopped()) return;

  const status = await deps.store.queue.complete(payload);
  deps.reporter.emit({
    op: "agent.router.parked",
    status: "ok",
    attributes: {
      continuationKey: payload.continuationKey,
      messageId: payload.messageId,
      dispatchId: payload.dispatchId,
      sessionId: payload.sessionId,
      completion: status,
    },
  });
  if (status === "pending") {
    runtime.pendingDispatches.add(payload.dispatchId);
    reportPendingRender(deps, payload);
    return;
  }
  if (status === "completed") await kick(deps, payload.continuationKey);
}
