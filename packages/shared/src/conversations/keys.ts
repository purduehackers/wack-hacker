/** Private Redis key catalog for the persisted conversation aggregate. */

import { z } from "zod";

/**
 * Index members carry their own prefix so a set can be read back without a
 * second lookup. The two schemas below are the only readers of that shape, and
 * naming them keeps the parse from being a bare regex plus a `typeof` guard.
 *
 * These stay one-way on purpose. A codec would validate the *write* side too,
 * and `queueMember`/`renderMember` are called with keys that operators pass in
 * on the command line — turning a malformed argument into a throw at the key
 * builder would change what `ops-inspect` does.
 */
const queueMemberSchema = z.stringFormat("queue-member", /^k:\d{17,20}$/u);
const renderMemberSchema = z.stringFormat("render-member", /^r:[0-9a-f-]{36}$/iu);

export const QUEUE_INDEX_KEY = "agent:queues";
export const AGENT_READY_SET_KEY = "agent:ready";
export const AGENT_RENDER_READY_SET_KEY = "agent:render-ready";

export function pendingKey(continuationKey: string): string {
  return `pending:${continuationKey}`;
}

export function resetPendingKey(continuationKey: string): string {
  return `agent:reset-pending:${continuationKey}`;
}

export function seenKey(continuationKey: string): string {
  return `agent:seen:${continuationKey}`;
}

export function activeKey(continuationKey: string): string {
  return `agent:active:${continuationKey}`;
}

export function resetKey(continuationKey: string): string {
  return `agent:reset:${continuationKey}`;
}

export function ingressKey(continuationKey: string): string {
  return `agent:ingress:${continuationKey}`;
}

export function parkedKey(continuationKey: string): string {
  return `agent:parked:${continuationKey}`;
}

export function queueMember(continuationKey: string): string {
  return `k:${continuationKey}`;
}

export function continuationKeyFromQueueMember(member: unknown): string | undefined {
  const parsed = queueMemberSchema.safeParse(member);
  return parsed.success ? parsed.data.slice(2) : undefined;
}

export function renderTargetKey(dispatchId: string): string {
  return `agent:render-target:${dispatchId}`;
}

export function renderIntentKey(dispatchId: string): string {
  return `agent:render-intent:${dispatchId}`;
}

export function renderProjectionKey(dispatchId: string): string {
  return `agent:render-projection:${dispatchId}`;
}

export function renderClaimKey(dispatchId: string): string {
  return `agent:render-claim:${dispatchId}`;
}

export function renderOutcomeKey(dispatchId: string): string {
  return `agent:render-outcome:${dispatchId}`;
}

export function renderMember(dispatchId: string): string {
  return `r:${dispatchId}`;
}

export function dispatchIdFromRenderMember(member: unknown): string | undefined {
  const parsed = renderMemberSchema.safeParse(member);
  return parsed.success ? parsed.data.slice(2) : undefined;
}

export function hitlClaimKey(dispatchId: string): string {
  return `agent:hitl-claim:${dispatchId}`;
}

export function interactionReceiptKey(interactionId: string): string {
  return `agent:interaction-receipt:${interactionId}`;
}

export function authorizationChallengeKey(dispatchId: string, authorizationId: string): string {
  return `agent:authorization:${dispatchId}:${authorizationId}`;
}

export function authorizationIndexKey(dispatchId: string): string {
  return `agent:authorization-index:${dispatchId}`;
}

export function scheduledFireReceiptKey(occurrenceId: string): string {
  return `agent:scheduled-fire:${occurrenceId}`;
}
