/** @fileoverview Private Redis key catalog for the persisted conversation aggregate. */

import { z } from "zod";

/**
 * Index members carry their own prefix so a reader can decode a set entry
 * without a second lookup. The two schemas below are the only readers of that
 * shape. Naming them keeps the parse from being a bare regex plus a `typeof`
 * guard.
 *
 * These stay one-way on purpose. A codec would validate the *write* side too,
 * yet `queueMember`/`renderMember` take keys that operators pass in on the
 * command line. Turning a malformed argument into a throw at the key builder
 * would change what `ops-inspect` does.
 */
const queueMemberSchema = z.stringFormat("queue-member", /^k:\d{17,20}$/u);
const renderMemberSchema = z.stringFormat("render-member", /^r:[0-9a-f-]{36}$/iu);

export const QUEUE_INDEX_KEY = "agent:queues";
export const AGENT_READY_SET_KEY = "agent:ready";
export const AGENT_RENDER_READY_SET_KEY = "agent:render-ready";

/**
 * The FIFO list of queued deliveries for one conversation. `claim` pops from
 * here, so order of arrival is order of service.
 */
export function pendingKey(continuationKey: string): string {
  return `pending:${continuationKey}`;
}

/**
 * The shadow queue a reset diverts new messages into, so the cutover can clear
 * the real queue without discarding what arrived meanwhile.
 */
export function resetPendingKey(continuationKey: string): string {
  return `agent:reset-pending:${continuationKey}`;
}

/**
 * The dedupe set of Discord message ids this conversation already accepted.
 * Its membership check is the only reason a redelivered webhook does not queue
 * a second turn.
 */
export function seenKey(continuationKey: string): string {
  return `agent:seen:${continuationKey}`;
}

/**
 * The delivery record for the turn in flight: phase, leases, session, and the
 * raw delivery. Every fence in the delivery machine reads or writes this one
 * key.
 */
export function activeKey(continuationKey: string): string {
  return `agent:active:${continuationKey}`;
}

/**
 * The reset barrier. While it holds the attempt's token, claim and ingress
 * refuse, and new messages divert to the shadow queue.
 */
export function resetKey(continuationKey: string): string {
  return `agent:reset:${continuationKey}`;
}

/** Keyed by delivery, because a conversation's next turn delegates separately. */
export function subagentKey(dispatchId: string): string {
  return `agent:subagent:${dispatchId}`;
}

/**
 * The marker a finished turn leaves behind. `complete` requires it, and it
 * names the exact delivery and session it releases, so a stale completion
 * cannot free a newer turn.
 */
export function parkedKey(continuationKey: string): string {
  return `agent:parked:${continuationKey}`;
}

/**
 * Set-member form of a continuation key, prefixed so
 * `continuationKeyFromQueueMember` can validate it on the way back out.
 */
export function queueMember(continuationKey: string): string {
  return `k:${continuationKey}`;
}

/**
 * Reads the continuation key back out of an index member. A member that does
 * not match the expected shape reads as `undefined`, so one junk entry cannot
 * stop the sweep that found it.
 */
export function continuationKeyFromQueueMember(member: unknown): string | undefined {
  const parsed = queueMemberSchema.safeParse(member);
  return parsed.success ? parsed.data.slice(2) : undefined;
}

/**
 * Where this delivery may paint, fixed at enqueue time. The value never changes
 * afterward, so a retried paint cannot land in a channel that moved.
 */
export function renderTargetKey(dispatchId: string): string {
  return `agent:render-target:${dispatchId}`;
}

/**
 * What the agent wants on screen for this delivery, fenced by revision. The
 * bot paints from this key and never from agent state directly.
 */
export function renderIntentKey(dispatchId: string): string {
  return `agent:render-intent:${dispatchId}`;
}

/**
 * What the bot actually painted: message ids and content hashes. A paint retry
 * consults this so it edits existing messages instead of posting duplicates.
 */
export function renderProjectionKey(dispatchId: string): string {
  return `agent:render-projection:${dispatchId}`;
}

/**
 * The renderer's lease over one paint. Painting spans several Discord calls,
 * so this claim is what stops two painters interleaving their edits.
 */
export function renderClaimKey(dispatchId: string): string {
  return `agent:render-claim:${dispatchId}`;
}

/**
 * The terminal verdict for a paint: `applied` or `discarded`. `complete` on
 * the delivery side refuses to release the conversation until this key holds
 * one of the two.
 */
export function renderOutcomeKey(dispatchId: string): string {
  return `agent:render-outcome:${dispatchId}`;
}

/**
 * Set-member form of a dispatch id for the render-ready set, prefixed so
 * `dispatchIdFromRenderMember` can validate the round trip.
 */
export function renderMember(dispatchId: string): string {
  return `r:${dispatchId}`;
}

/**
 * Reads the dispatch id back out of a render-ready member. A member that does
 * not match the expected shape reads as `undefined` instead of failing the
 * whole sweep.
 */
export function dispatchIdFromRenderMember(member: unknown): string | undefined {
  const parsed = renderMemberSchema.safeParse(member);
  return parsed.success ? parsed.data.slice(2) : undefined;
}

/**
 * First-click-wins claim on a human-input question. Anyone in the channel can
 * click, so this key decides whose answer forwards and tells the rest the
 * question is taken.
 */
export function hitlClaimKey(dispatchId: string): string {
  return `agent:hitl-claim:${dispatchId}`;
}

/**
 * The durable receipt for one component click. A Discord retry of the same
 * interaction id answers from this record, because running the click twice
 * would double its effect.
 */
export function interactionReceiptKey(interactionId: string): string {
  return `agent:interaction-receipt:${interactionId}`;
}

/**
 * One stored authorization challenge, such as an OAuth consent or a device
 * code. It lives in Redis because the resolving click happens in the bot
 * process, which cannot read agent state.
 */
export function authorizationChallengeKey(dispatchId: string, authorizationId: string): string {
  return `agent:authorization:${dispatchId}:${authorizationId}`;
}

/**
 * The set of challenge keys open for one dispatch. Cleanup needs it because a
 * challenge key alone becomes unreachable once the turn that knew its id ends.
 */
export function authorizationIndexKey(dispatchId: string): string {
  return `agent:authorization-index:${dispatchId}`;
}

/**
 * The claim-then-receipt for one scheduled occurrence. It ensures an
 * occurrence fires at most once: `accepted` here refuses every later attempt
 * for good.
 */
export function scheduledFireReceiptKey(occurrenceId: string): string {
  return `agent:scheduled-fire:${occurrenceId}`;
}
