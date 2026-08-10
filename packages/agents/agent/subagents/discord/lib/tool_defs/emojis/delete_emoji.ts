import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildEmojiResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";

export const delete_emoji = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a custom emoji. This is irreversible and will remove the emoji from all messages where it was used (they will show as unknown emoji).",
  input: z.strictObject({ emoji_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    const emoji = discordObject<RESTGetAPIGuildEmojiResult>(
      await rest.get(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id)),
      "get guild emoji",
    );
    await rest.delete(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id));
    return { success: true, deleted: emoji.name ?? input.emoji_id };
  },
});
