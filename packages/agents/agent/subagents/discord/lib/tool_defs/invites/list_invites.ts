import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildInvitesResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { empty } from "../../constants.ts";
import { summarizeInvite } from "../../projections.ts";

export const list_invites = defineTool({
  access: { risk: "read", minRole: "admin" },
  description:
    "List all active server invites with their codes, channels, creators, usage counts, and expiry dates.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    return discordArray<RESTGetAPIGuildInvitesResult>(
      await rest.get(Routes.guildInvites(DISCORD_GUILD_ID)),
      "list guild invites",
    ).map(summarizeInvite);
  },
});
