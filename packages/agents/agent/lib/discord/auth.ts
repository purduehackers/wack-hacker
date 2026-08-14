/** The authenticated assertion a Discord delivery carries into eve. */

import { DISCORD_GUILD_ID, roleFromMemberRoles } from "@repo/shared/discord";
import type { InteractionPayload, Principal } from "@repo/shared/wire";
import type { SessionAuthContext } from "eve/context";

export interface DiscordAuthTarget {
  /** Parent channel retained for policy decisions. */
  channelId: string;
  threadId?: string;
  /** Present only for a new user turn, not for a HITL continuation. */
  messageId?: string;
  dispatchId?: string;
  /** The actual channel or thread where rendering occurs. */
  renderChannelId?: string;
  inputRequestId?: string;
  source?: "chat" | "scheduled";
  scheduleId?: string;
  occurrenceId?: string;
  approvalRequester?: InteractionPayload["approvalRequester"];
}

/**
 * The authenticated assertion for one delivery, shaped for eve's session auth.
 * Policy rules read these attributes, so the role derives from member roles
 * here, once, instead of inside every rule.
 */
export function authFor(principal: Principal, target: DiscordAuthTarget): SessionAuthContext {
  return {
    authenticator: "discord",
    principalType: "user",
    principalId: principal.userId,
    attributes: {
      role: roleFromMemberRoles(principal.memberRoles),
      memberRoles: principal.memberRoles,
      username: principal.username,
      nickname: principal.nickname,
      channelId: target.channelId,
      threadId: target.threadId ?? "",
      guildId: DISCORD_GUILD_ID,
      source: target.source ?? "chat",
      ...(target.approvalRequester === undefined
        ? {}
        : {
            approvalRequesterId: target.approvalRequester.userId,
            approvalRequesterRole: roleFromMemberRoles(target.approvalRequester.memberRoles),
            approvalRequesterMemberRoles: target.approvalRequester.memberRoles,
          }),
      ...(target.scheduleId === undefined ? {} : { scheduleId: target.scheduleId }),
      ...(target.occurrenceId === undefined ? {} : { occurrenceId: target.occurrenceId }),
      ...(target.messageId === undefined ? {} : { discordMessageId: target.messageId }),
      ...(target.dispatchId === undefined ? {} : { discordDispatchId: target.dispatchId }),
      ...(target.renderChannelId === undefined ? {} : { renderChannelId: target.renderChannelId }),
      ...(target.inputRequestId === undefined
        ? {}
        : { discordInputRequestId: target.inputRequestId }),
    },
  };
}
