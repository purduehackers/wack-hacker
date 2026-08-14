import { Routes, type RESTPostAPIChannelMessagesBulkDeleteJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, messageId } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const bulk_delete_messages = defineTool({
  access: { risk: "destructive" },
  description:
    "Bulk delete 2-100 messages from a channel in a single call. Messages must be less than 14 days old. Irreversible.",
  input: z.strictObject({
    channel_id: channelId,
    message_ids: z.array(messageId).min(2).max(100),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    await rest.post(Routes.channelBulkDelete(input.channel_id), {
      body: {
        messages: input.message_ids,
      } satisfies RESTPostAPIChannelMessagesBulkDeleteJSONBody,
    });
    return { deleted: input.message_ids.length, message_ids: input.message_ids };
  },
});
