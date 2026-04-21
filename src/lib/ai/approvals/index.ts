import type { ApprovalOptions } from "./types.ts";

const APPROVAL_MARKER = Symbol("approval");

/** Mark a tool as requiring per-call user approval before execution. */
export function approval<T>(t: T, opts: ApprovalOptions = {}): T {
  (t as Record<symbol, ApprovalOptions>)[APPROVAL_MARKER] = opts;
  return t;
}

/** Return the approval options if the tool is marked, else null. */
export function getApprovalOptions(t: unknown): ApprovalOptions | null {
  if (!t || typeof t !== "object") return null;
  const marker = (t as Record<symbol, unknown>)[APPROVAL_MARKER];
  return marker ? (marker as ApprovalOptions) : null;
}

/** True iff the tool has the approval marker. */
export function hasApprovalMarker(t: unknown): boolean {
  return getApprovalOptions(t) !== null;
}

export { wrapApprovalTools } from "./runtime.ts";
export { ApprovalStore } from "./store.ts";
export {
  buildApprovalComponents,
  buildApprovalEmbed,
  buildDecisionEmbed,
  formatToolCall,
} from "./helpers.ts";
export type {
  ApprovalOptions,
  ApprovalState,
  ApprovalStoreLike,
  BuildApprovalEmbedArgs,
  WaitForOptions,
  WrapApprovalOptions,
} from "./types.ts";
