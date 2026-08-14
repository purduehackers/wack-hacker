import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { ChannelType, Routes, type RESTGetAPIGuildChannelsResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import {
  discordArray,
  discordObject,
  discordRest,
  malformedDiscordResponse,
} from "../../client.ts";
import { empty, responseInt, summarizeChannel, type GuildChannelResult } from "../../constants.ts";

/** Threads are channels on the wire. The server layout the model reads is not. */
const THREAD_CHANNEL_TYPES = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

function channelPosition(channel: GuildChannelResult): number {
  const parsed = responseInt.safeParse("position" in channel ? channel.position : undefined);
  if (!parsed.success) throw malformedDiscordResponse("list guild channels");
  return parsed.data;
}

function byPosition(left: GuildChannelResult, right: GuildChannelResult): number {
  return channelPosition(left) - channelPosition(right);
}

export const list_channels = defineTool({
  access: { risk: "read" },
  description:
    "List all channels in the Discord server, organized by category. Returns channel IDs, names, types, topics, and positions. Use this to find the right channel before sending messages or performing channel operations.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    const all = discordArray<RESTGetAPIGuildChannelsResult>(
      await rest.get(Routes.guildChannels(DISCORD_GUILD_ID)),
      "list guild channels",
    ).map((rawChannel) => discordObject<GuildChannelResult>(rawChannel, "list guild channels"));
    const channels = all.filter((entry) => !THREAD_CHANNEL_TYPES.has(entry.type));
    const categories = channels
      .filter((entry) => entry.type === ChannelType.GuildCategory)
      .sort(byPosition);
    const uncategorized = channels
      .filter((entry) => entry.type !== ChannelType.GuildCategory && !entry.parent_id)
      .sort(byPosition);
    return [
      ...categories.map((category) => ({
        category: { id: category.id, name: category.name, position: channelPosition(category) },
        channels: channels
          .filter((entry) => entry.parent_id === category.id)
          .sort(byPosition)
          .map(summarizeChannel),
      })),
      ...(uncategorized.length === 0
        ? []
        : // oxlint-disable-next-line unicorn/no-null -- the uncategorized group carries an explicit null category, matching Discord's own "no parent" encoding.
          [{ category: null, channels: uncategorized.map(summarizeChannel) }]),
    ];
  },
});
