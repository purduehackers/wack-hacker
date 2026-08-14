import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTPatchAPIGuildMemberJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId } from "../../constants.ts";

export const set_nickname = defineTool({
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
});
