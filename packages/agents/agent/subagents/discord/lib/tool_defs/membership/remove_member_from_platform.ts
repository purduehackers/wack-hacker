import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, reason } from "../../constants.ts";

export const remove_member_from_platform = defineTool({
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
});
