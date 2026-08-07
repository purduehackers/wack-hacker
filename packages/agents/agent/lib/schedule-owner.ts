/** Trusted schedule ownership and policy derived from Eve's current delivery. */

import { UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { SessionContext } from "eve/context";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

import { decideCapability } from "./policy/engine.ts";
import { requirePrincipal } from "./policy/principal.ts";
import { CapabilityKind, Confirmation, RiskLevel } from "./policy/types.ts";
import type { ScheduleOwner } from "./schedule-store.ts";

const DISCORD_ID = /^\d{17,20}$/u;

function discordId(value: unknown): string | undefined {
  return typeof value === "string" && DISCORD_ID.test(value) ? value : undefined;
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

/** Central policy adapter for owner-scoped scheduling mutations. */
export function approveScheduleMutation(
  name: "schedule_task" | "cancel_task",
  ctx: ApprovalContext,
): ApprovalStatus {
  const principal = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(principal)) {
    return { type: "denied", reason: principal.error.message };
  }
  const decision = decideCapability(principal.value, {
    kind: CapabilityKind.Tool,
    name,
    minRole: UserRole.Organizer,
    risk: RiskLevel.Write,
    confirmation: Confirmation.Self,
  });
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
