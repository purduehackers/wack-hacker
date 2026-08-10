import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildRolesResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { empty } from "../../constants.ts";

export const list_roles = defineTool({
  access: { risk: "read" },
  description:
    "List all roles in the Discord server with their colors, positions, and whether they are hoisted or mentionable. Use this to find role IDs before assigning or managing roles.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    return [
      ...discordArray<RESTGetAPIGuildRolesResult>(
        await rest.get(Routes.guildRoles(DISCORD_GUILD_ID)),
        "list guild roles",
      ),
    ]
      .sort((left, right) => right.position - left.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: `#${Number(role.color ?? 0)
          .toString(16)
          .padStart(6, "0")}`,
        position: role.position,
        mentionable: role.mentionable,
        hoist: role.hoist,
        managed: role.managed,
        isEveryone: role.id === DISCORD_GUILD_ID,
      }));
  },
});
