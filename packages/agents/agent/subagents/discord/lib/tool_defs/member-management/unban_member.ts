import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, reason } from "../../constants.ts";

export const unban_member = defineTool({
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
});
