import {
  Routes,
  type RESTPostAPIChannelMessageJSONBody,
  type RESTPostAPIChannelMessageResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId, guildChannel } from "../../constants.ts";

export const send_message = defineTool({
  access: { risk: "destructive" },
  description:
    "Send a message to a channel. Supports Discord markdown formatting. Returns the sent message's ID, channel ID, and content.",
  input: z.strictObject({
    channel_id: channelId,
    content: z.string().min(1).max(2_000),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const message = discordObject<RESTPostAPIChannelMessageResult>(
      await rest.post(Routes.channelMessages(input.channel_id), {
        body: { content: input.content } satisfies RESTPostAPIChannelMessageJSONBody,
      }),
      "send channel message",
    );
    return { id: message.id, channelId: message.channel_id, content: message.content };
  },
});
