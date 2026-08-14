import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTPatchAPIGuildRolePositionsJSONBody,
  type RESTPostAPIGuildRoleJSONBody,
  type RESTPostAPIGuildRoleResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { hexColor, httpUrl } from "../../constants.ts";
import { imageDataUri, positionedRole, summarizeRole } from "../../projections.ts";

export const create_role = defineTool({
  access: { risk: "write" },
  description:
    "Create a new role in the server. You can set the name, color, whether it is hoisted (displayed separately in the sidebar), mentionable, and an icon or unicode emoji.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(100),
    color: hexColor.optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    position: z.int().min(1).optional(),
    icon: httpUrl.optional(),
    unicode_emoji: z.string().trim().min(1).max(32).optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    const icon = input.icon === undefined ? undefined : await imageDataUri(input.icon);
    const role = discordObject<RESTPostAPIGuildRoleResult>(
      await rest.post(Routes.guildRoles(DISCORD_GUILD_ID), {
        body: compact<RESTPostAPIGuildRoleJSONBody>({
          name: input.name,
          color: input.color === undefined ? undefined : Number.parseInt(input.color.slice(1), 16),
          hoist: input.hoist,
          mentionable: input.mentionable,
          icon,
          unicode_emoji: input.unicode_emoji,
        }),
      }),
      "create guild role",
    );
    if (input.position === undefined) return summarizeRole(role);
    const positioned = positionedRole(
      await rest.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
        body: [
          { id: role.id, position: input.position },
        ] satisfies RESTPatchAPIGuildRolePositionsJSONBody,
      }),
      role.id,
    );
    return summarizeRole(positioned);
  },
});
