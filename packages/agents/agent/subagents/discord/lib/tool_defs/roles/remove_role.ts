import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, roleId } from "../../constants.ts";

export const remove_role = defineTool({
  access: { risk: "destructive" },
  description:
    "Remove a role from a server member. Requires both the member's user ID and the role ID.",
  input: z.strictObject({ member_id: memberId, role_id: roleId }),
  execute: async (input) => {
    const rest = discordRest();
    await rest.delete(Routes.guildMemberRole(DISCORD_GUILD_ID, input.member_id, input.role_id));
    return { success: true, member: input.member_id, role: input.role_id };
  },
});
