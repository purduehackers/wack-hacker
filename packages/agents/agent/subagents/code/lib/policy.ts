/** Fail-closed adapter from Eve auth to the shared Phase-3 capability policy. */

import { UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  decideCapability,
  requirePrincipal,
  type CapabilityDecision,
} from "../../../lib/policy/index.ts";
import { codeWorkspaceState } from "./state.ts";

type MutationRisk = typeof RiskLevel.Write | typeof RiskLevel.Destructive;

export interface CodePolicyDecision {
  readonly allowed: boolean;
  readonly approval: CapabilityDecision["approve"];
  readonly reason?: string;
}

/**
 * Policy is evaluated from `auth.current` at the point of use. No initiator or
 * session role is accepted as a fallback, so a missing helper/auth path denies.
 */
export function decideCodeCapability(
  current: SessionAuthContext | null | undefined,
  name: string,
  risk: RiskLevel,
  kind: CapabilityKind = CapabilityKind.Tool,
): CodePolicyDecision {
  const workspace = codeWorkspaceState.get();
  if (
    name !== "code_post_finish" &&
    workspace.phase === "ready" &&
    workspace.publication !== undefined
  ) {
    return {
      allowed: false,
      approval: "deny",
      reason: "Code publication is complete; code_post_finish was the terminal capability.",
    };
  }

  const principal = requirePrincipal(current);
  if (Result.isError(principal)) {
    return {
      allowed: false,
      approval: "deny",
      reason: "Current caller authentication is required.",
    };
  }

  const decision = decideCapability(principal.value, {
    kind,
    name,
    minRole: UserRole.Admin,
    risk,
    ...(risk === RiskLevel.Read ? {} : { confirmation: Confirmation.Self }),
  });
  if (Result.isError(decision)) {
    return {
      allowed: false,
      approval: "deny",
      reason: "Capability policy could not be evaluated.",
    };
  }

  if (!decision.value.discover || !decision.value.execute) {
    return {
      allowed: false,
      approval: "deny",
      reason: "This code capability requires a current admin role.",
    };
  }

  return { allowed: true, approval: decision.value.approve };
}

export function codeMutationApproval(
  current: SessionAuthContext | null | undefined,
  name: string,
  risk: MutationRisk = RiskLevel.Write,
): ApprovalStatus {
  const decision = decideCodeCapability(current, name, risk);
  if (!decision.allowed) {
    return { type: "denied", reason: decision.reason ?? "Capability denied." };
  }
  if (decision.approval !== Confirmation.Self) {
    return {
      type: "denied",
      reason: "Code mutations require approval by the current requesting admin.",
    };
  }
  return "user-approval";
}
