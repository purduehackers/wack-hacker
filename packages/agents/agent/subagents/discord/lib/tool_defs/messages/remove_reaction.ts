import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, discordSnowflakeSchema, messageId } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const remove_reaction = defineTool({
  access: { risk: "destructive" },
  description:
    "Remove a specific user's reaction from a message. Pass '@me' for the bot's own reaction.",
  input: z.strictObject({
    channel_id: channelId,
    message_id: messageId,
    emoji: z.string().trim().min(1).max(100),
    user_id: z.union([discordSnowflakeSchema, z.literal("@me")]),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const emoji = encodeURIComponent(input.emoji);
    const route =
      input.user_id === "@me"
        ? Routes.channelMessageOwnReaction(input.channel_id, input.message_id, emoji)
        : Routes.channelMessageUserReaction(
            input.channel_id,
            input.message_id,
            emoji,
            input.user_id,
          );
    await rest.delete(route);
    return { removed: true };
  },
});
