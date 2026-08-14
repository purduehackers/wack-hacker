import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, messageId } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const add_reaction = defineTool({
  access: { risk: "write" },
  description:
    "Add a reaction emoji to a message. Use Unicode emoji characters (e.g. '\u{1F44D}') or custom emoji in the format 'name:id' (e.g. 'custom_emoji:123456789').",
  input: z.strictObject({
    channel_id: channelId,
    message_id: messageId,
    emoji: z.string().trim().min(1).max(100),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    await rest.put(
      Routes.channelMessageOwnReaction(
        input.channel_id,
        input.message_id,
        encodeURIComponent(input.emoji),
      ),
    );
    return { success: true, reacted: input.emoji };
  },
});
