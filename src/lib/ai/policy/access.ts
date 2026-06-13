import type { AccessSpec } from "./types.ts";

import { getApprovalOptions } from "../approvals/index.ts";

const ACCESS_MARKER = Symbol("access");

/** Attach a declarative access descriptor to a tool. */
export function access<T>(spec: AccessSpec, t: T): T {
  (t as Record<symbol, AccessSpec>)[ACCESS_MARKER] = spec;
  return t;
}

/** Return the access descriptor if the tool carries one, else null. */
export function getAccessSpec(t: unknown): AccessSpec | null {
  if (!t || typeof t !== "object") return null;
  const marker = (t as Record<symbol, unknown>)[ACCESS_MARKER];
  return marker ? (marker as AccessSpec) : null;
}

/**
 * Resolve the effective access spec for a tool. Tools without an `access()`
 * marker fall back to behavior-preserving legacy semantics: a lingering
 * `approval()` marker maps to `confirm: "self"`, and unmarked tools stay
 * visible to everyone with no confirmation — exactly what they got before
 * the policy layer existed. This keeps meta-tools (loadSkill, delegates) and
 * any not-yet-migrated tool working while migration proceeds.
 */
export function resolveAccessSpec(t: unknown): AccessSpec {
  const marked = getAccessSpec(t);
  if (marked) return marked;
  const legacyApproval = getApprovalOptions(t);
  if (legacyApproval) {
    return { risk: "write", minRole: "public", confirm: "self", reason: legacyApproval.reason };
  }
  return { risk: "write", minRole: "public", confirm: "none" };
}
