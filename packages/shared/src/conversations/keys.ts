/** Private Redis key catalog for the persisted conversation aggregate. */

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
  if (typeof member !== "string" || !/^k:\d{17,20}$/.test(member)) return undefined;
  return member.slice(2);
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
  if (typeof member !== "string" || !/^r:[0-9a-f-]{36}$/i.test(member)) return undefined;
  return member.slice(2);
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
