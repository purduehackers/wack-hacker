import {
  Routes,
  type RESTPostAPIChannelFollowersJSONBody,
  type RESTPostAPIChannelFollowersResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId, guildChannel } from "../../constants.ts";

export const follow_announcement_channel = defineTool({
  access: { risk: "destructive" },
  description:
    "Follow an announcement channel — its messages will be auto-crossposted to the target channel in this server. Only announcement channels can be followed.",
  input: z.strictObject({
    source_channel_id: channelId,
    target_channel_id: channelId,
  }),
  execute: async (input) => {
    const rest = discordRest();
    await Promise.all([
      guildChannel(rest, input.source_channel_id),
      guildChannel(rest, input.target_channel_id),
    ]);
    const followed = discordObject<RESTPostAPIChannelFollowersResult>(
      await rest.post(Routes.channelFollowers(input.source_channel_id), {
        body: {
          webhook_channel_id: input.target_channel_id,
        } satisfies RESTPostAPIChannelFollowersJSONBody,
      }),
      "follow announcement channel",
    );
    return {
      followed: true,
      source: input.source_channel_id,
      target: followed.channel_id,
      webhook_id: followed.webhook_id,
    };
  },
});
