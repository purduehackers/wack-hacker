import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, messageId } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const pin_message = defineTool({
  access: { risk: "write" },
  description:
    "Pin a message in a channel. Pinned messages appear in the channel's pinned messages panel for easy reference.",
  input: z.strictObject({ channel_id: channelId, message_id: messageId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    await rest.put(Routes.channelPin(input.channel_id, input.message_id));
    return { success: true, pinned: input.message_id };
  },
});
