import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildStickersResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { empty } from "../../constants.ts";
import { summarizeSticker } from "../../projections.ts";

export const list_stickers = defineTool({
  access: { risk: "read" },
  description:
    "List all custom stickers in the Discord server. Returns each sticker's ID, name, description, tags, and URL.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    return discordArray<RESTGetAPIGuildStickersResult>(
      await rest.get(Routes.guildStickers(DISCORD_GUILD_ID)),
      "list guild stickers",
    ).map(summarizeSticker);
  },
});
