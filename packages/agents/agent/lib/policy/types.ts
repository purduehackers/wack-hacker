import { ConfirmMode, PolicySource, RiskLevel } from "@repo/shared/db";
import type { ConfirmMode as ConfirmationValue } from "@repo/shared/db";
import type { UserRole } from "@repo/shared/discord";

export const CapabilityKind = {
  Subagent: "subagent",
  Tool: "tool",
  Skill: "skill",
} as const;
export type CapabilityKind = (typeof CapabilityKind)[keyof typeof CapabilityKind];

export { PolicySource, RiskLevel };

export const Confirmation = ConfirmMode;
export type Confirmation = ConfirmationValue;

/** A copyable, JSON-only descriptor for every model-visible capability. */
export interface CapabilityDescriptor {
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly minRole: UserRole;
  readonly risk: RiskLevel;
  /** Reads and writes default to none; destructive actions default to self confirmation. */
  readonly confirmation?: Confirmation;
}

/** Derived for the current delivery. Never persist this as a session authorization snapshot. */
export interface PolicyPrincipal {
  readonly userId: string;
  readonly role: UserRole;
  readonly source: PolicySource;
}

export interface BudgetState {
  readonly used: number;
  readonly limit: number;
}

export interface PolicyEvaluationContext {
  /** Omit only when the budget backend is unavailable (the sole fail-open dimension). */
  readonly budget?: BudgetState;
}

export interface CapabilityDecision {
  readonly discover: boolean;
  readonly execute: boolean;
  readonly approve: "deny" | Confirmation;
  readonly denial?: "role" | "budget";
}
