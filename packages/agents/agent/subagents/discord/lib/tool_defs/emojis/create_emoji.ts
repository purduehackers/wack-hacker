import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTPostAPIGuildEmojiJSONBody,
  type RESTPostAPIGuildEmojiResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { emojiName, httpUrl, imageDataUri, roleId, summarizeEmoji } from "../../constants.ts";

export const create_emoji = defineTool({
  access: { risk: "write" },
  description:
    "Create a custom emoji from an image URL. The image must be PNG, JPG, or GIF and under 256KB. You can restrict usage to specific roles.",
  input: z.strictObject({
    name: emojiName,
    url: httpUrl,
    roles: z.array(roleId).max(100).optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    const created = discordObject<RESTPostAPIGuildEmojiResult>(
      await rest.post(Routes.guildEmojis(DISCORD_GUILD_ID), {
        body: compact<RESTPostAPIGuildEmojiJSONBody>({
          name: input.name,
          image: await imageDataUri(input.url),
          roles: input.roles,
        }),
      }),
      "create guild emoji",
    );
    return summarizeEmoji(created);
  },
});
