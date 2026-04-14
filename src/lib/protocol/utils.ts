import { ChannelType, type Channel, type PublicThreadChannel, type TextChannel } from "discord.js";

export function isTextChannel(channel: Channel): channel is TextChannel | PublicThreadChannel {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.PublicThread;
}
