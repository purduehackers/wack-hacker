/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTPatchAPIGuildRoleJSONBody,
  type RESTPatchAPIGuildRolePositionsJSONBody,
  type RESTPatchAPIGuildRoleResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  hexColor,
  httpUrl,
  imageDataUri,
  positionedRole,
  roleId,
  summarizeRole,
} from "../../constants.ts";

export const edit_role = defineTool({
  access: { risk: "destructive" },
  description:
    "Edit an existing role's settings including name, color, hoist, mentionable, icon, and unicode emoji.",
  input: z.strictObject({
    role_id: roleId,
    name: z.string().trim().min(1).max(100).optional(),
    color: hexColor.optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    position: z.int().min(1).optional(),
    icon: httpUrl.nullable().optional(),
    unicode_emoji: z.string().trim().min(1).max(32).nullable().optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    const icon =
      input.icon === undefined || input.icon === null ? input.icon : await imageDataUri(input.icon);
    const role = discordObject<RESTPatchAPIGuildRoleResult>(
      await rest.patch(Routes.guildRole(DISCORD_GUILD_ID, input.role_id), {
        body: compact<RESTPatchAPIGuildRoleJSONBody>({
          name: input.name,
          color: input.color === undefined ? undefined : Number.parseInt(input.color.slice(1), 16),
          hoist: input.hoist,
          mentionable: input.mentionable,
          icon,
          unicode_emoji: input.unicode_emoji,
        }),
      }),
      "edit guild role",
    );
    if (input.position === undefined) return summarizeRole(role);
    const positioned = positionedRole(
      await rest.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
        body: [
          { id: input.role_id, position: input.position },
        ] satisfies RESTPatchAPIGuildRolePositionsJSONBody,
      }),
      input.role_id,
    );
    return summarizeRole(positioned);
  },
});
