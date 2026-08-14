/** @fileoverview Trusted schedule ownership and policy derived from Eve's current delivery. */

import { UserRole } from "@repo/shared/discord";
import type { InvariantViolated, Unauthenticated } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext, SessionContext } from "eve/context";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import { z } from "zod";

import { decideCapability } from "../policy/engine.ts";
import { requirePrincipal } from "../policy/principal.ts";
import type { AuthAttribute } from "../policy/types.ts";
import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDecision,
} from "../policy/types.ts";
import { discordSnowflake } from "../schema.ts";
import type { ScheduleOwner } from "./store.ts";

type ScheduleMutationName = "schedule_task" | "cancel_task";
/** At most one Discord role per position in the guild's role list. */
const memberRolesSchema = z.array(discordSnowflake).max(64);

function discordId(value: AuthAttribute | undefined): string | undefined {
  return discordSnowflake.safeParse(value).data;
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

/**
 * The identity a schedule runs under: an authenticated Discord user, the
 * channel it delivers into, and the user's current member roles. Throws when
 * the session cannot prove any of the three, so no schedule ends up unowned
 * or undeliverable.
 */
export function requireScheduleOwner(ctx: SessionContext): ScheduleOwner {
  const auth = ctx.session.auth.current;
  if (
    auth === null ||
    auth.authenticator !== "discord" ||
    auth.principalType !== "user" ||
    !discordSnowflake.safeParse(auth.principalId).success
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

  const memberRoles = memberRolesSchema.safeParse(attributes.memberRoles);
  if (!memberRoles.success) {
    throw new Error("scheduled tasks require current Discord role identifiers");
  }

  return { ownerId: auth.principalId, channelId, memberRoles: memberRoles.data };
}

/**
 * The owner check plus the capability policy for the two schedule mutations.
 * Throws when policy denies the mutation, so the tool body never acts for a
 * caller the policy engine refused.
 */
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
