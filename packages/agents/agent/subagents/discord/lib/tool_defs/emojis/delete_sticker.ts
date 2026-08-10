import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";

export const delete_sticker = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a custom sticker. Irreversible — all prior uses of the sticker become unresolved references.",
  input: z.strictObject({ sticker_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    await rest.delete(Routes.guildSticker(DISCORD_GUILD_ID, input.sticker_id));
    return { deleted: true, sticker_id: input.sticker_id };
  },
});
