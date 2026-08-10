import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, guildChannel, messageId } from "../../constants.ts";

export const delete_message = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a message from a channel. Requires the message ID and channel ID. This is irreversible.",
  input: z.strictObject({ channel_id: channelId, message_id: messageId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    await rest.delete(Routes.channelMessage(input.channel_id, input.message_id));
    return { success: true, deleted: input.message_id };
  },
});
