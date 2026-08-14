import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTPatchAPIGuildEmojiJSONBody,
  type RESTPatchAPIGuildEmojiResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema, emojiName, roleId } from "../../constants.ts";
import { summarizeEmoji } from "../../projections.ts";

export const edit_emoji = defineTool({
  access: { risk: "write" },
  description:
    "Edit a custom emoji's name or role restrictions. Pass an empty roles array to make the emoji available to everyone.",
  input: z.strictObject({
    emoji_id: discordSnowflakeSchema,
    name: emojiName.optional(),
    roles: z.array(roleId).max(100).optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    return summarizeEmoji(
      discordObject<RESTPatchAPIGuildEmojiResult>(
        await rest.patch(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id), {
          body: compact<RESTPatchAPIGuildEmojiJSONBody>({ name: input.name, roles: input.roles }),
        }),
        "edit guild emoji",
      ),
    );
  },
});
