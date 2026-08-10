/**
 * Discord member administration — bans, kicks, timeouts, nicknames and directory lookups.
 *
 * These are ordinary provider calls against Discord's REST API, exactly like
 * Linear or Notion: the agent holds its own Discord identity rather than asking
 * the bot to moderate on its behalf.
 */
/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { makeURLSearchParams } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { httpStatusOf } from "@repo/shared/errors";
import {
  Routes,
  type RESTGetAPIGuildBansQuery,
  type RESTGetAPIGuildBansResult,
  type RESTGetAPIGuildMemberResult,
  type RESTGetAPIGuildMembersSearchQuery,
  type RESTGetAPIGuildMembersSearchResult,
  type RESTPatchAPIGuildMemberJSONBody,
  type RESTPostAPIChannelInviteJSONBody,
  type RESTPostAPIChannelInviteResult,
  type RESTPutAPIGuildBanJSONBody,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../lib/policy/domain-tools.ts";
import { discordArray, discordObject, discordRest } from "../rest.ts";
import {
  channelId,
  discordSnowflakeSchema,
  guildChannel,
  memberId,
  reason,
  responseString,
} from "./common.ts";

function summarizeMember(member: RESTGetAPIGuildMemberResult) {
  const user = discordObject<RESTGetAPIGuildMemberResult["user"]>(member.user, "guild member user");
  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    nickname: member.nick ?? null,
    roles: member.roles,
    joinedAt: member.joined_at ?? null,
    isBot: user.bot ?? false,
  };
}

export const MEMBER_OPERATIONS = {
  ban_member: defineTool({
    access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
    description:
      "Ban a member from the Discord server. They cannot rejoin until unbanned. Optionally delete the last N seconds of their messages (0-604800, 0 by default).",
    input: z.strictObject({
      member_id: memberId,
      delete_message_seconds: z.int().min(0).max(604_800).optional(),
      reason: reason.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.put(Routes.guildBan(DISCORD_GUILD_ID, input.member_id), {
        body: {
          delete_message_seconds: input.delete_message_seconds ?? 0,
        } satisfies RESTPutAPIGuildBanJSONBody,
        reason: input.reason,
      });
      return { banned: true, member_id: input.member_id };
    },
  }),

  unban_member: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description: "Remove a ban for a Discord user, allowing them to rejoin the server.",
    input: z.strictObject({ user_id: memberId, reason: reason.optional() }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.delete(Routes.guildBan(DISCORD_GUILD_ID, input.user_id), {
        reason: input.reason,
      });
      return { unbanned: true, user_id: input.user_id };
    },
  }),

  list_bans: defineTool({
    access: { risk: "read", minRole: "admin" },
    description:
      "List banned users in the Discord server. Returns user ID, username, and ban reason. Paginated via before/after cursors (snowflake IDs).",
    input: z.strictObject({
      limit: z.int().min(1).max(1_000).optional(),
      before: discordSnowflakeSchema.optional(),
      after: discordSnowflakeSchema.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      return discordArray<RESTGetAPIGuildBansResult>(
        await rest.get(Routes.guildBans(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildBansQuery>({
            limit: input.limit ?? 100,
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.after === undefined ? {} : { after: input.after }),
          }),
        }),
        "list guild bans",
      ).map((ban) => {
        const user = discordObject<RESTGetAPIGuildBansResult[number]["user"]>(
          ban.user,
          "guild ban user",
        );
        return {
          userId: user.id,
          username: user.global_name ?? user.username,
          reason: ban.reason ?? null,
        };
      });
    },
  }),

  kick_member: defineTool({
    access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
    description:
      "Kick a member from the Discord server. They can rejoin via a new invite. For permanent removal, use ban_member instead.",
    input: z.strictObject({ member_id: memberId, reason: reason.optional() }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.delete(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        reason: input.reason,
      });
      return { kicked: true, member_id: input.member_id };
    },
  }),

  timeout_member: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Timeout a member. They cannot send messages, react, speak, or join voice until the timeout expires. Max duration is 28 days.",
    input: z.strictObject({
      member_id: memberId,
      duration_seconds: z.int().min(1).max(2_419_200),
      reason: reason.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      const timeoutUntil = new Date(Date.now() + input.duration_seconds * 1_000).toISOString();
      await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        body: {
          communication_disabled_until: timeoutUntil,
        } satisfies RESTPatchAPIGuildMemberJSONBody,
        reason: input.reason,
      });
      return { timeout_until: timeoutUntil, member_id: input.member_id };
    },
  }),

  clear_timeout: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Clear an active timeout on a member, restoring their ability to talk immediately.",
    input: z.strictObject({ member_id: memberId, reason: reason.optional() }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        body: {
          communication_disabled_until: null,
        } satisfies RESTPatchAPIGuildMemberJSONBody,
        reason: input.reason,
      });
      return { timeout_cleared: true, member_id: input.member_id };
    },
  }),

  get_member: defineTool({
    access: { risk: "read" },
    description:
      "Get detailed information about a server member including their roles, join date, nickname, avatar, and boost status. Use search_members first if you only have a name.",
    input: z.strictObject({ member_id: memberId }),
    execute: async (input) => {
      const rest = discordRest();
      try {
        const member = discordObject<RESTGetAPIGuildMemberResult>(
          await rest.get(Routes.guildMember(DISCORD_GUILD_ID, input.member_id)),
          "get guild member",
        );
        const user = discordObject<RESTGetAPIGuildMemberResult["user"]>(
          member.user,
          "guild member user",
        );
        const guildAvatar = responseString.safeParse(member.avatar).data;
        const userAvatar = responseString.safeParse(user.avatar).data;
        return {
          ...summarizeMember(member),
          premiumSince: member.premium_since ?? null,
          avatar:
            guildAvatar === undefined
              ? userAvatar === undefined
                ? null
                : `https://cdn.discordapp.com/avatars/${String(user.id)}/${userAvatar}.png`
              : `https://cdn.discordapp.com/guilds/${DISCORD_GUILD_ID}/users/${String(user.id)}/${guildAvatar}.png`,
        };
      } catch (cause) {
        if (httpStatusOf(cause) === 404) return { error: "Member not found" };
        throw cause;
      }
    },
  }),

  set_nickname: defineTool({
    access: { risk: "write" },
    description:
      "Set or clear a member's server nickname. Pass null to clear the nickname and revert to their username.",
    input: z.strictObject({
      member_id: memberId,
      nickname: z.string().trim().min(1).max(32).nullable(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        body: { nick: input.nickname } satisfies RESTPatchAPIGuildMemberJSONBody,
      });
      return { success: true, member: input.member_id, nickname: input.nickname };
    },
  }),

  search_members: defineTool({
    access: { risk: "read" },
    description:
      "Search for server members by name, nickname, or user ID. Returns member info including roles, join date, and display name. Use this to find a user before performing member operations.",
    input: z.strictObject({
      query: z.string().trim().min(1).max(100),
      limit: z.int().min(1).max(100).default(10),
    }),
    execute: async (input) => {
      const rest = discordRest();
      if (discordSnowflakeSchema.safeParse(input.query).success) {
        try {
          return [
            summarizeMember(
              discordObject<RESTGetAPIGuildMemberResult>(
                await rest.get(Routes.guildMember(DISCORD_GUILD_ID, input.query)),
                "get guild member",
              ),
            ),
          ];
        } catch (cause) {
          if (httpStatusOf(cause) === 404) return [];
          throw cause;
        }
      }
      return discordArray<RESTGetAPIGuildMembersSearchResult>(
        await rest.get(Routes.guildMembersSearch(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildMembersSearchQuery>({
            query: input.query,
            limit: input.limit,
          }),
        }),
        "search guild members",
      ).map(summarizeMember);
    },
  }),

  add_member_to_platform: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Invite a new member to the Discord server by creating a one-time-use invite link. Bot tokens cannot add users directly (that requires OAuth2 with guilds.join scope), so this returns an invite URL that the new member opens to join. Defaults to a single-use invite that expires in 24h.",
    input: z.strictObject({
      channel_id: channelId,
      max_age_seconds: z.int().min(0).max(604_800).optional(),
      max_uses: z.int().min(0).max(100).optional(),
      reason: reason.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const invite = discordObject<RESTPostAPIChannelInviteResult>(
        await rest.post(Routes.channelInvites(input.channel_id), {
          body: {
            max_age: input.max_age_seconds ?? 86_400,
            max_uses: input.max_uses ?? 1,
            temporary: false,
            unique: true,
          } satisfies RESTPostAPIChannelInviteJSONBody,
          reason: input.reason,
        }),
        "add member invite",
      );
      const code = responseString.safeParse(invite.code).data;
      return {
        code: invite.code,
        url: code === undefined ? null : `https://discord.gg/${code}`,
        maxAge: invite.max_age,
        maxUses: invite.max_uses,
        expiresAt: invite.expires_at ?? null,
      };
    },
  }),

  remove_member_from_platform: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Remove (kick) a member from the Discord server. The user can rejoin with a new invite. Resolve the member ID first via search_members — never kick on ambiguous input. To permanently block them, ban them via ban_member instead.",
    input: z.strictObject({ member_id: memberId, reason: reason.optional() }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.delete(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        reason: input.reason,
      });
      return { removed: true, member_id: input.member_id };
    },
  }),
} as const;
