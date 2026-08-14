import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { httpStatusOf } from "@repo/shared/errors";
import { Routes, type RESTGetAPIGuildMemberResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { memberId, responseString } from "../../constants.ts";
import { summarizeMember } from "../../projections.ts";

export const get_member = defineTool({
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
        premiumSince: member.premium_since ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
        avatar:
          guildAvatar === undefined
            ? userAvatar === undefined
              ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
              : `https://cdn.discordapp.com/avatars/${String(user.id)}/${userAvatar}.png`
            : `https://cdn.discordapp.com/guilds/${DISCORD_GUILD_ID}/users/${String(user.id)}/${guildAvatar}.png`,
      };
    } catch (cause) {
      if (httpStatusOf(cause) === 404) return { error: "Member not found" };
      throw cause;
    }
  },
});
