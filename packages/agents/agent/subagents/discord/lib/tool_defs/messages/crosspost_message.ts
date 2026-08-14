import { Routes, type RESTPostAPIChannelMessageCrosspostResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId, messageId } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const crosspost_message = defineTool({
  access: { risk: "destructive" },
  description:
    "Publish (crosspost) a message in an announcement channel so it's sent to following channels.",
  input: z.strictObject({ channel_id: channelId, message_id: messageId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const message = discordObject<RESTPostAPIChannelMessageCrosspostResult>(
      await rest.post(Routes.channelMessageCrosspost(input.channel_id, input.message_id)),
      "crosspost channel message",
    );
    return { id: message.id, crossposted: true };
  },
});
