import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId } from "../../constants.ts";
import { guildChannel, type GuildChannelResult } from "../../projections.ts";

export const delete_channel = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a channel from the server. This is irreversible and will permanently remove the channel and all its messages.",
  input: z.strictObject({ channel_id: channelId }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const deleted = discordObject<GuildChannelResult>(
      await rest.delete(Routes.channel(input.channel_id)),
      "delete channel",
    );
    return { success: true, deleted: deleted.name ?? input.channel_id };
  },
});
