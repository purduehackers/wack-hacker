import { Routes, type RESTGetAPIChannelMessageResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId, messageId } from "../../constants.ts";
import { guildChannel, summarizeMessage } from "../../projections.ts";

export const get_message = defineTool({
  access: { risk: "read" },
  description:
    "Get a single message by channel ID and message ID. Returns the message content, author, timestamps, attachments, embeds, and pin status.",
  input: z.strictObject({ channel_id: channelId, message_id: messageId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    return summarizeMessage(
      discordObject<RESTGetAPIChannelMessageResult>(
        await rest.get(Routes.channelMessage(input.channel_id, input.message_id)),
        "get channel message",
      ),
    );
  },
});
