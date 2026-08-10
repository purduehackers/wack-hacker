import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTGetAPIChannelWebhooksResult,
  type RESTGetAPIGuildWebhooksResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { channelId, guildChannel, summarizeWebhook } from "../../constants.ts";

export const list_webhooks = defineTool({
  access: { risk: "read" },
  description:
    "List webhooks in the server or a specific channel. Returns webhook IDs, names, channel IDs, and avatars; webhook tokens and URLs are never exposed.",
  input: z.strictObject({ channel_id: channelId.optional() }),
  execute: async (input) => {
    const rest = discordRest();
    if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
    const path =
      input.channel_id === undefined
        ? Routes.guildWebhooks(DISCORD_GUILD_ID)
        : Routes.channelWebhooks(input.channel_id);
    return discordArray<RESTGetAPIGuildWebhooksResult | RESTGetAPIChannelWebhooksResult>(
      await rest.get(path),
      "list webhooks",
    ).map(summarizeWebhook);
  },
});
