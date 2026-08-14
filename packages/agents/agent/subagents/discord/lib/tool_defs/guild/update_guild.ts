/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTPatchAPIGuildJSONBody,
  type RESTPatchAPIGuildResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema, guildChannel } from "../../constants.ts";

/** The guild PATCH carries imagery inline, so the model must supply bytes, not a URL. */
const dataUri = z
  .stringFormat("image-data-uri", /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/iu)
  .max(8_000_000);

export const update_guild = defineTool({
  access: { risk: "destructive", minRole: "admin" },
  description:
    "Update core Discord server settings — name, description, icon, banner, afk channel, verification level, etc. Only provide the fields you want to change.",
  input: z.strictObject({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().max(120).optional(),
    icon: dataUri.nullable().optional(),
    banner: dataUri.nullable().optional(),
    splash: dataUri.nullable().optional(),
    afk_channel_id: discordSnowflakeSchema.nullable().optional(),
    afk_timeout: z.literal([60, 300, 900, 1_800, 3_600]).optional(),
    verification_level: z.int().min(0).max(4).optional(),
    default_message_notifications: z.literal([0, 1]).optional(),
    explicit_content_filter: z.int().min(0).max(2).optional(),
    system_channel_id: discordSnowflakeSchema.nullable().optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    for (const id of [input.afk_channel_id, input.system_channel_id])
      if (id !== undefined && id !== null) await guildChannel(rest, id);
    const guild = discordObject<RESTPatchAPIGuildResult>(
      await rest.patch(Routes.guild(DISCORD_GUILD_ID), {
        body: compact<RESTPatchAPIGuildJSONBody>({
          name: input.name,
          description: input.description,
          icon: input.icon,
          banner: input.banner,
          splash: input.splash,
          afk_channel_id: input.afk_channel_id,
          afk_timeout: input.afk_timeout,
          verification_level: input.verification_level,
          default_message_notifications: input.default_message_notifications,
          explicit_content_filter: input.explicit_content_filter,
          system_channel_id: input.system_channel_id,
        }),
      }),
      "update guild",
    );
    return { id: guild.id, name: guild.name, description: guild.description ?? null };
  },
});
