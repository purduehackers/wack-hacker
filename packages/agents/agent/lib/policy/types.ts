/**
 * @fileoverview Shared vocabulary for the capability policy: what a capability
 * declares, who asks for it, and what the evaluation decides. The engine and
 * its callers both depend on these shapes, so they live apart from either.
 */

import { ConfirmMode, PolicySource, RiskLevel } from "@repo/shared/db/enums";
import type { ConfirmMode as ConfirmationValue } from "@repo/shared/db/enums";
import type { UserRole } from "@repo/shared/discord";
import type { SessionAuthContext } from "eve/context";

/**
 * One entry of Eve's authenticated attribute bag: a single string or a list of
 * strings. Every narrowing of one is therefore load-bearing, not a formality.
 */
export type AuthAttribute = SessionAuthContext["attributes"][string];

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
  /** Reads and writes default to none. Destructive actions default to self confirmation. */
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
  readonly denial?: "role" | "budget" | "confirmation";
}
