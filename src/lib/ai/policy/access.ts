import type { AccessSpec } from "./types.ts";

import { getApprovalOptions } from "../approvals/index.ts";
import { getToolMeta } from "../tools/_shared/define-tool.ts";

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
 * Resolve the effective access spec for a tool. Precedence:
 *   1. `defineTool`'s metadata (the canonical single marker, once a tool is
 *      authored through the factory);
 *   2. a standalone `access()` marker (tools not yet migrated to `defineTool`);
 *   3. behavior-preserving legacy fallback — a lingering `approval()` marker
 *      maps to `confirm: "self"`, and unmarked tools (the dynamically-built
 *      `delegate_<domain>` tools, gated upstream by skill `minRole`) stay
 *      visible with no confirmation, exactly as before the policy layer.
 */
export function resolveAccessSpec(t: unknown): AccessSpec {
  const meta = getToolMeta(t);
  if (meta) return meta.access;
  const marked = getAccessSpec(t);
  if (marked) return marked;
  const legacyApproval = getApprovalOptions(t);
  if (legacyApproval) {
    return { risk: "write", minRole: "public", confirm: "self", reason: legacyApproval.reason };
  }
  return { risk: "write", minRole: "public", confirm: "none" };
}
