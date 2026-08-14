import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildEmojisResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { empty } from "../../constants.ts";
import { summarizeEmoji } from "../../projections.ts";

export const list_emojis = defineTool({
  access: { risk: "read" },
  description:
    "List all custom emojis in the server. Returns emoji IDs, names, animation status, image URLs, and role restrictions.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    return discordArray<RESTGetAPIGuildEmojisResult>(
      await rest.get(Routes.guildEmojis(DISCORD_GUILD_ID)),
      "list guild emojis",
    ).map(summarizeEmoji);
  },
});
