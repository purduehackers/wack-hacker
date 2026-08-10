import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildVanityUrlResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { empty, responseString } from "../../constants.ts";

export const get_vanity_url = defineTool({
  access: { risk: "read" },
  description:
    "Get the Discord server's vanity invite URL (e.g. discord.gg/purduehackers) if one is configured. Returns code and usage count.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    const vanity = discordObject<RESTGetAPIGuildVanityUrlResult>(
      await rest.get(Routes.guildVanityUrl(DISCORD_GUILD_ID)),
      "get guild vanity URL",
    );
    const code = responseString.safeParse(vanity.code).data;
    return code === undefined
      ? { configured: false }
      : {
          configured: true,
          code,
          url: `https://discord.gg/${code}`,
          uses: vanity.uses,
        };
  },
});
