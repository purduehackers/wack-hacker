/**
 * The inbound operations: everything a caller asks the flow to do.
 *
 * Each one moves the durable queue forward exactly one step and then, where a
 * delivery slot may have opened, calls `kick` to claim the next item. Nothing
 * here loops — the sweep owns repetition.
 */

import type { Holder } from "@repo/shared/conversations";
import { messageOf, tagOf, Transient } from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { sliceText } from "@repo/shared/text";
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
  const next = await deps.store.delivery.claim(continuationKey);
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
    await deps.store.delivery.confirmSession(
      continuationKey,
      claimed.claimToken,
      sent.value.sessionId,
    );
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

/** Matches `content` on the wire schema, so a fold can never overflow it. */
const MAX_CONTENT = 9_000;

/** Every durable step here fails the same way: a `Transient` naming what failed. */
function transient(operation: string) {
  return (cause: unknown): Transient => new Transient({ operation, detail: messageOf(cause) });
}

/**
 * Fold the request being corrected into the correction itself.
 *
 * Steering cancels the running turn, and eve's durable history "keeps only what
 * had already settled" — so a turn cancelled a second in takes its request with
 * it. Asked to check some channels and then told "the channels are in discord
 * btw", the agent replied asking what you wanted, having genuinely forgotten.
 *
 * Both utterances are in hand right here, so they go in as one message rather
 * than being stashed somewhere for the agent to reassemble. eve then has the
 * whole request in the only place it needs to look, which is the message. This
 * is what eve's own TUI means by coalescing a queued message into the next turn.
 */
function coalesce(payload: MessagePayload, superseded: string | undefined): MessagePayload {
  if (superseded === undefined || superseded === "") return payload;
  return { ...payload, content: sliceText(`${superseded}\n\n${payload.content}`, MAX_CONTENT) };
}

/**
 * Interrupt the turn holding this conversation, if one is.
 *
 * Someone who types while the agent is working is correcting it, not waiting in
 * line. Cancelling happens agent-side; this only tells it to. Failures are
 * reported and swallowed — the message stays queued either way, and the hard cap
 * eventually releases the conversation even if the agent is unreachable.
 */
async function steerHolder(
  deps: ConversationFlowDeps,
  holder: Holder,
  continuationKey: string,
): Promise<void> {
  const steered = await deps.eve.sendSteer({ continuationKey });
  if (Result.isOk(steered)) return;
  deps.reporter.emit({
    op: "agent.router.steer",
    status: "error",
    errorTag: tagOf(steered.error),
    errorMessage: steered.error.message,
    attributes: { continuationKey, sessionId: holder.sessionId },
  });
}

export async function submitMessage(
  runtime: FlowRuntime,
  payload: MessagePayload,
): Promise<Result<void, AgentError>> {
  const { deps } = runtime;
  const submitted = await Result.tryPromise({
    try: async () => {
      // Asked before anything is enqueued or claimed. A turn holding the
      // conversation now was started by an earlier delivery and is working on a
      // request this message corrects, so its text joins this one and then it is
      // interrupted to let the queue move. Asking after the claim instead finds
      // the turn *this* message just started and cancels it, which is a turn
      // that never gets to answer anything.
      const holder = await deps.store.deliveries.holder(payload.continuationKey);
      await deps.store.delivery.enqueue(coalesce(payload, holder?.content));
      if (runtime.isStopped()) return undefined;
      if (holder !== undefined) await steerHolder(deps, holder, payload.continuationKey);
      return kick(deps, payload.continuationKey);
    },
    catch: transient("agent.router.submit"),
  });
  if (Result.isError(submitted)) return submitted;
  return submitted.value === undefined ? Result.ok(undefined) : Result.err(submitted.value);
}

export async function resetAndKick(
  runtime: FlowRuntime,
  payload: ResetPayload,
): Promise<Result<void, KnownError>> {
  const { deps } = runtime;
  const prepared = await Result.tryPromise({
    try: () => deps.store.delivery.beginReset(payload.continuationKey),
    catch: transient("agent.router.begin-reset"),
  });
  if (Result.isError(prepared)) return prepared;

  const resetId = prepared.value;
  // An ambiguous remote result keeps the barrier installed. A later reset reuses
  // the same id and safely finishes or retries the cutover.
  const reset = await deps.eve.sendReset({ ...payload, resetId });
  if (Result.isError(reset)) return reset;

  const committed = await Result.tryPromise({
    try: () => deps.store.delivery.commitReset(payload.continuationKey, resetId),
    catch: transient("agent.router.commit-reset"),
  });
  if (Result.isError(committed)) return committed;
  if (!committed.value) {
    return Result.err(
      new Transient({
        operation: "agent.router.commit-reset",
        detail: "reset cutover ownership was lost",
      }),
    );
  }
  if (!runtime.isStopped()) await kick(deps, payload.continuationKey);
  return Result.ok(undefined);
}

export async function answerHitl(
  deps: ConversationFlowDeps,
  { claim, payload }: ConversationAnswer,
): Promise<ConversationAnswerResult> {
  const claimed = await deps.store.hitl.claim(claim);
  if (claimed !== "acquired") return { status: claimed };
  const sent = await deps.eve.sendInteraction(payload);
  if (Result.isError(sent)) return { status: "failed", error: sent.error };
  const completed = await deps.store.hitl.accept(
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
  const claim = await deps.store.schedules.claim(payload, claimToken);
  if (claim === "accepted") return;
  if (claim === "in-progress") throw new Error("scheduled occurrence is already being admitted");
  try {
    await deps.schedules.admit(payload, submit);
    if (!(await deps.store.schedules.complete(payload, claimToken))) {
      throw new Error("scheduled occurrence admission receipt ownership was lost");
    }
  } catch (cause) {
    await deps.store.schedules
      .release(payload.occurrenceId, claimToken)
      .catch((releaseCause: unknown) =>
        console.warn("could not release scheduled occurrence claim", releaseCause),
      );
    throw cause;
  }
}

export async function onParked(runtime: FlowRuntime, payload: ParkedPayload): Promise<void> {
  const { deps } = runtime;
  /** The paint has not landed yet; the next sweep will try again. */
  const waitForPaint = (): void => {
    runtime.pendingDispatches.add(payload.dispatchId);
    reportPendingRender(deps, payload);
  };

  if (runtime.isStopped()) return;
  if ((await deps.store.renders.outcome(payload.dispatchId)) === undefined) return waitForPaint();
  if (runtime.isStopped()) return;

  const status = await deps.store.delivery.complete(payload);
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
  if (status === "pending") return waitForPaint();
  if (status === "completed") await kick(deps, payload.continuationKey);
}
