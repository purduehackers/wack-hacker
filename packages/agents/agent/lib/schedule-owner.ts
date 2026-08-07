/** Trusted schedule ownership and policy derived from Eve's current delivery. */

import { UserRole } from "@repo/shared/discord";
import type { InvariantViolated, Unauthenticated } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext, SessionContext } from "eve/context";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

import { decideCapability } from "./policy/engine.ts";
import { requirePrincipal } from "./policy/principal.ts";
import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDecision,
} from "./policy/types.ts";
import type { ScheduleOwner } from "./schedule-store.ts";

const DISCORD_ID = /^\d{17,20}$/u;
type ScheduleMutationName = "schedule_task" | "cancel_task";

function discordId(value: unknown): string | undefined {
  return typeof value === "string" && DISCORD_ID.test(value) ? value : undefined;
}

function scheduleMutationDecision(
  name: ScheduleMutationName,
  current: SessionAuthContext | null | undefined,
): Result<CapabilityDecision, Unauthenticated | InvariantViolated> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  return decideCapability(principal.value, {
    kind: CapabilityKind.Tool,
    name,
    minRole: UserRole.Organizer,
    risk: RiskLevel.Write,
    confirmation: Confirmation.Self,
  });
}

export function requireScheduleOwner(ctx: SessionContext): ScheduleOwner {
  const auth = ctx.session.auth.current;
  if (
    auth === null ||
    auth.authenticator !== "discord" ||
    auth.principalType !== "user" ||
    !DISCORD_ID.test(auth.principalId)
  ) {
    throw new Error("an authenticated Discord user is required to manage scheduled tasks");
  }

  const attributes = auth.attributes;
  const channelId =
    discordId(attributes["renderChannelId"]) ??
    discordId(attributes["threadId"]) ??
    discordId(attributes["channelId"]);
  if (channelId === undefined) {
    throw new Error("scheduled tasks require a Discord channel destination");
  }

  const memberRoles = attributes.memberRoles;
  if (
    !Array.isArray(memberRoles) ||
    memberRoles.length > 64 ||
    !memberRoles.every((role): role is string => discordId(role) !== undefined)
  ) {
    throw new Error("scheduled tasks require current Discord role identifiers");
  }

  return { ownerId: auth.principalId, channelId, memberRoles };
}

export function requireScheduleMutationOwner(
  ctx: SessionContext,
  name: ScheduleMutationName,
): ScheduleOwner {
  const decision = scheduleMutationDecision(name, ctx.session.auth.current);
  if (Result.isError(decision)) throw decision.error;
  if (!decision.value.execute || decision.value.approve === "deny") {
    throw new Error("current policy denies this schedule change");
  }
  return requireScheduleOwner(ctx);
}

/** Central policy adapter for owner-scoped scheduling mutations. */
export function approveScheduleMutation(
  name: ScheduleMutationName,
  ctx: ApprovalContext,
): ApprovalStatus {
  const decision = scheduleMutationDecision(name, ctx.session.auth.current);
  if (Result.isError(decision) || !decision.value.execute || decision.value.approve === "deny") {
    return {
      type: "denied",
      reason: Result.isError(decision)
        ? decision.error.message
        : "Policy denied this schedule change.",
    };
  }
  if (decision.value.approve === Confirmation.None) return "not-applicable";
  if (decision.value.approve === Confirmation.Self) return "user-approval";
  return { type: "denied", reason: "This schedule change requires second-party approval." };
}
