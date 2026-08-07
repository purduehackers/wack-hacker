import {
  roleAtLeast,
  roleFromMemberRoles,
  UserRole,
  type UserRole as UserRoleValue,
} from "@repo/shared/discord";
import { Result } from "@repo/shared/result";

import type { ApprovalPolicyStore } from "./approval-record.ts";
import { PolicySource, type PolicyPrincipal, type RiskLevel } from "./types.ts";

export interface ExecutionAuthority {
  readonly principal: PolicyPrincipal;
  readonly decidedBy?: string;
}

export interface ExecutionAuthorityInput {
  readonly current: PolicyPrincipal;
  readonly approvalRequesterId: unknown;
  readonly approvalRequesterMemberRoles: unknown;
  readonly sessionId: string;
  readonly callId: string;
  readonly tool: string;
  readonly risk: RiskLevel;
  readonly requesterMinRole: UserRoleValue;
  readonly approvalPolicies: Pick<ApprovalPolicyStore, "read">;
}

function expectedApproverRole(requesterMinRole: UserRoleValue): Exclude<UserRoleValue, "public"> {
  return requesterMinRole === UserRole.Public ? UserRole.Organizer : requesterMinRole;
}

/**
 * Rebinds a second-party approval to the requester who owns execution. Every
 * authority-bearing field is checked against the durable policy record and the
 * bot's freshly fetched Discord roles before the approver can resume the call.
 */
export async function resolveExecutionAuthority(
  input: ExecutionAuthorityInput,
): Promise<ExecutionAuthority | undefined> {
  const requesterId = input.approvalRequesterId;
  if (typeof requesterId !== "string") return { principal: input.current };
  const freshMemberRoles = input.approvalRequesterMemberRoles;
  if (
    !Array.isArray(freshMemberRoles) ||
    !freshMemberRoles.every((role): role is string => typeof role === "string")
  ) {
    return undefined;
  }

  const policy = await input.approvalPolicies.read(input.sessionId, input.callId);
  if (
    Result.isError(policy) ||
    policy.value === undefined ||
    policy.value.requesterUserId !== requesterId ||
    policy.value.tool !== input.tool ||
    policy.value.risk !== input.risk ||
    policy.value.minApproverRole !== expectedApproverRole(input.requesterMinRole) ||
    input.current.userId === requesterId ||
    !roleAtLeast(input.current.role, policy.value.minApproverRole)
  ) {
    return undefined;
  }

  const requesterAccess = roleFromMemberRoles(freshMemberRoles);
  if (!roleAtLeast(requesterAccess, input.requesterMinRole)) return undefined;
  return {
    principal: { userId: requesterId, role: requesterAccess, source: PolicySource.Chat },
    decidedBy: input.current.userId,
  };
}
