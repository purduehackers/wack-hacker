import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, messageId } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const unpin_message = defineTool({
  access: { risk: "write", confirm: "self" },
  description:
    "Unpin a message in a channel. Removes the message from the channel's pinned messages panel.",
  input: z.strictObject({ channel_id: channelId, message_id: messageId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    await rest.delete(Routes.channelPin(input.channel_id, input.message_id));
    return { success: true, unpinned: input.message_id };
  },
});
