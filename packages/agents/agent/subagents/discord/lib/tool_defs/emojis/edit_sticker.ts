/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTPatchAPIGuildStickerJSONBody,
  type RESTPatchAPIGuildStickerResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema, summarizeSticker } from "../../constants.ts";

export const edit_sticker = defineTool({
  access: { risk: "write" },
  description: "Edit a custom sticker's name, description, or tag.",
  input: z.strictObject({
    sticker_id: discordSnowflakeSchema,
    name: z.string().trim().min(2).max(30).optional(),
    description: z.string().trim().min(2).max(100).nullable().optional(),
    tags: z.string().trim().min(2).max(200).optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    return summarizeSticker(
      discordObject<RESTPatchAPIGuildStickerResult>(
        await rest.patch(Routes.guildSticker(DISCORD_GUILD_ID, input.sticker_id), {
          body: compact<RESTPatchAPIGuildStickerJSONBody>({
            name: input.name,
            description: input.description,
            tags: input.tags,
          }),
        }),
        "edit guild sticker",
      ),
    );
  },
});
