import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildRolesResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { roleId } from "../../constants.ts";

export const delete_role = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a role from the server. This is irreversible and will remove the role from all members who have it.",
  input: z.strictObject({ role_id: roleId }),
  execute: async (input) => {
    const rest = discordRest();
    const guildRoles = discordArray<RESTGetAPIGuildRolesResult>(
      await rest.get(Routes.guildRoles(DISCORD_GUILD_ID)),
      "list guild roles",
    );
    const targetRole = guildRoles.find((entry) => entry.id === input.role_id);
    if (targetRole === undefined) return { error: "Role not found" };
    await rest.delete(Routes.guildRole(DISCORD_GUILD_ID, input.role_id));
    return { success: true, deleted: targetRole.name };
  },
});
