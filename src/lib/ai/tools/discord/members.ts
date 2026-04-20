import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const get_member = tool({
  description:
    "Get detailed information about a server member including their roles, join date, nickname, avatar, and boost status. Use search_members first if you only have a name.",
  inputSchema: z.object({
    member_id: z.string().describe("Member (user) ID"),
  }),
  execute: async ({ member_id }) => {
    try {
      const member = (await discord.get(Routes.guildMember(DISCORD_GUILD_ID, member_id))) as any;
      return JSON.stringify({
        id: member.user.id,
        username: member.user.username,
        displayName: member.user.global_name ?? member.user.username,
        nickname: member.nick ?? null,
        roles: member.roles ?? [],
        joinedAt: member.joined_at ?? null,
        isBot: member.user.bot ?? false,
        premiumSince: member.premium_since ?? null,
        avatar: member.avatar
          ? `https://cdn.discordapp.com/guilds/${DISCORD_GUILD_ID}/users/${member.user.id}/avatars/${member.avatar}.png`
          : member.user.avatar
            ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
            : null,
      });
    } catch {
      return JSON.stringify({ error: "Member not found" });
    }
  },
});

export const set_nickname = tool({
  description:
    "Set or clear a member's server nickname. Pass null to clear the nickname and revert to their username.",
  inputSchema: z.object({
    member_id: z.string().describe("Member (user) ID"),
    nickname: z.string().nullable().describe("New nickname (null to clear)"),
  }),
  execute: async ({ member_id, nickname }) => {
    await discord.patch(Routes.guildMember(DISCORD_GUILD_ID, member_id), {
      body: { nick: nickname },
    });
    return JSON.stringify({
      success: true,
      member: member_id,
      nickname,
    });
  },
});
