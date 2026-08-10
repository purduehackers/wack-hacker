import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, guildChannel, messageId } from "../../constants.ts";

export const remove_all_reactions = defineTool({
  access: { risk: "destructive" },
  description: "Remove every reaction from a message. Irreversible.",
  input: z.strictObject({ channel_id: channelId, message_id: messageId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    await rest.delete(Routes.channelMessageAllReactions(input.channel_id, input.message_id));
    return { cleared: true };
  },
});
