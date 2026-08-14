/**
 * @fileoverview The inbound operations: everything a caller asks the flow to do.
 *
 * Each one moves the durable queue forward exactly one step. Where that step
 * may open a delivery slot, it calls `kick` to claim the next item. Nothing
 * here loops — the sweep owns repetition.
 */

import type { Holder } from "@repo/shared/conversations";
import { messageOf, tagOf, Transient } from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { sliceText } from "@repo/shared/text";
import { MAX_CONTENT_CHARS, MAX_SCHEDULE_CONTENT_CHARS } from "@repo/shared/wire";
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

/**
 * Claims the next queued delivery for this conversation and sends it to eve.
 * A claim failure becomes a defect report while the item stays queued for
 * the sweep. A send failure comes back for the caller to handle.
 */
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
      claimed.payload.dispatchId,
      claimed.payload.messageId,
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

/**
 * The cap a folded message must respect, which depends on the kind.
 *
 * `content` carries `max(9_000)` on the schema, but a refinement holds anything
 * that did not come from a schedule to 4_000 — Discord's own ceiling. Folding to
 * the larger number produced a payload `enqueue` stored happily and `claim` could
 * never decode, wedging the conversation until the turn lease lapsed.
 */
function contentLimit(payload: MessagePayload): number {
  return payload.kind === "scheduled" ? MAX_SCHEDULE_CONTENT_CHARS : MAX_CONTENT_CHARS;
}

/** Every durable step here fails the same way: a `Transient` naming what failed. */
function transient(operation: string) {
  return (cause: unknown): Transient => new Transient({ operation, detail: messageOf(cause) });
}

/**
 * Fold the request under correction into the correction itself.
 *
 * Steering cancels the running turn, and eve's durable history "keeps only what
 * had already settled" — so a turn cancelled a second in takes its request with
 * it. Asked to check some channels and then told "the channels are in discord
 * btw", the agent replied asking what you wanted, having genuinely forgotten.
 *
 * Both utterances are in hand right here, so this function folds them into one
 * message rather than stashing them for the agent to reassemble. eve then has the
 * whole request in the only place it needs to look, which is the message. This
 * is what eve's own TUI means by coalescing a queued message into the next turn.
 */
function coalesce(payload: MessagePayload, superseded: string | undefined): MessagePayload {
  if (superseded === undefined || superseded === "") return payload;
  const folded = `${superseded}\n\n${payload.content}`;
  return { ...payload, content: sliceText(folded, contentLimit(payload)) };
}

/**
 * Interrupt the turn holding this conversation, if one is.
 *
 * Someone who types during a running turn means to correct it, not to wait in
 * line. Cancelling happens agent-side. This function only tells it to, and it
 * reports and swallows failures — the message stays queued either way. The
 * hard cap eventually releases the conversation even if the agent is
 * unreachable.
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

/**
 * Enqueues one inbound message, then kicks the queue so a free conversation
 * delivers at once. When a turn already holds the conversation, this folds
 * the held request into the new message and steers the turn. See `coalesce`
 * for why.
 */
export async function submitMessage(
  runtime: FlowRuntime,
  payload: MessagePayload,
): Promise<Result<void, AgentError>> {
  const { deps } = runtime;
  const submitted = await Result.tryPromise({
    try: async () => {
      // This lookup runs before the enqueue and before the claim. A turn that
      // holds the conversation now came from an earlier delivery and works on
      // a request this message corrects. So its text joins this one, and then
      // the steer interrupts the turn to let the queue move. Asking after the
      // claim instead finds the turn *this* message just started and cancels
      // it, which is a turn that never gets to answer anything.
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

/**
 * Runs the reset cutover behind a barrier, then kicks the queue. The barrier
 * survives an ambiguous remote result, so a later reset reuses the same id
 * and safely finishes or retries the cutover.
 */
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

/**
 * Delivers one human answer to a pending HITL request, exactly once. The
 * claim makes a racing answer lose with a plain status instead of a double
 * send. A completion failure after the send is a defect, not a retry.
 */
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

/**
 * Admits one scheduled occurrence under a claim token, exactly once. A
 * receipt from an earlier admission makes this a no-op, and a concurrent
 * admitter is an error. When admission fails, this function releases the
 * claim so a redelivered fire can try again.
 */
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

/**
 * Completes a delivery after eve parks the turn, but only once a render
 * outcome exists for the dispatch. Until then the dispatch id joins the
 * pending set and the next sweep tries again, so completion never outruns
 * the visible reply.
 */
export async function onParked(runtime: FlowRuntime, payload: ParkedPayload): Promise<void> {
  const { deps } = runtime;
  /** The paint has not landed yet. The next sweep will try again. */
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
