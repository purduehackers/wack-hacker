import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, reason } from "../../constants.ts";

export const kick_member = defineTool({
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
});
