import {
  Routes,
  type RESTPatchAPIChannelMessageJSONBody,
  type RESTPatchAPIChannelMessageResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId, guildChannel, messageId } from "../../constants.ts";

export const edit_message = defineTool({
  access: { risk: "destructive" },
  description:
    "Edit a message the bot sent. Only the bot's own messages can be edited. Replaces the content entirely.",
  input: z.strictObject({
    channel_id: channelId,
    message_id: messageId,
    content: z.string().min(1).max(2_000),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const message = discordObject<RESTPatchAPIChannelMessageResult>(
      await rest.patch(Routes.channelMessage(input.channel_id, input.message_id), {
        body: { content: input.content } satisfies RESTPatchAPIChannelMessageJSONBody,
      }),
      "edit channel message",
    );
    return { id: message.id, content: message.content };
  },
});
