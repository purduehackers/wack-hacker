import type {
  ConfirmMode,
  PolicyDecision,
  PolicyEvalContext,
  PolicySubject,
  PolicyToolRef,
  RiskLevel,
} from "./types.ts";

import { UserRole } from "../constants.ts";
import { BUDGET_DENY_MESSAGE } from "./constants.ts";

const ROLE_LEVEL: Record<UserRole, number> = {
  [UserRole.Public]: 0,
  [UserRole.Organizer]: 1,
  [UserRole.Admin]: 2,
};

/**
 * Role × risk defaults. Per-tool overrides come from the `access()` spec;
 * anything beyond that should become data in this table, not wrapper code.
 */
const RISK_DEFAULTS: Record<RiskLevel, { minRole: UserRole; confirm: ConfirmMode }> = {
  read: { minRole: UserRole.Public, confirm: "none" },
  write: { minRole: UserRole.Organizer, confirm: "none" },
  destructive: { minRole: UserRole.Organizer, confirm: "self" },
};

/** True iff `role` sits at or above `min` on the public<organizer<admin ladder. */
export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[min];
}

/**
 * The single policy decision point. Pure and serializable on both ends:
 * callers resolve roles and budget state first, then every enforcement layer
 * (tool visibility, confirmation wrapping, budget stubs) acts on the result.
 *
 * `deny` with code "role" is enforced as deny-by-absence — the tool must stay
 * invisible to the model, not surface as a denied call.
 */
export function decide(
  subject: PolicySubject,
  tool: PolicyToolRef,
  ctx: PolicyEvalContext,
): PolicyDecision {
  const defaults = RISK_DEFAULTS[tool.access.risk];

  const minRole = tool.access.minRole ?? defaults.minRole;
  if (!roleAtLeast(subject.role, minRole)) {
    return {
      kind: "deny",
      code: "role",
      message: `\`${tool.name}\` requires the ${minRole} role.`,
    };
  }

  const budget = ctx.budgetState;
  const budgetExempt = roleAtLeast(subject.role, UserRole.Organizer);
  if (!budgetExempt && budget && budget.used >= budget.limit) {
    return { kind: "deny", code: "budget", message: BUDGET_DENY_MESSAGE };
  }

  const confirm = tool.access.confirm ?? defaults.confirm;
  if (confirm === "second-party") return { kind: "approve", approvers: "second-party" };
  if (confirm === "self") return { kind: "confirm" };
  return { kind: "allow" };
}
