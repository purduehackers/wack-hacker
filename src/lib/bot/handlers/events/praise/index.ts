import { defineEvent } from "@/lib/bot/events/define";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const PRAISE_PATTERN = /wackity\s+hackity\s+praise\s+me/;
const DISMISS_PATTERN = /wackity\s+hackity\s+go\s+away/;

export const praise = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    const { content, author, guildId, channel } = packet.data;

    if (PRAISE_PATTERN.test(content)) {
      await ctx.discord.guilds.addRoleToMember(guildId, author.id, DISCORD_IDS.roles.WACKY);
      await ctx.discord.channels.addMessageReaction(channel.id, packet.data.id, "\u{1F973}");
    } else if (DISMISS_PATTERN.test(content)) {
      await ctx.discord.guilds.removeRoleFromMember(guildId, author.id, DISCORD_IDS.roles.WACKY);
      await ctx.discord.channels.addMessageReaction(channel.id, packet.data.id, "\u{1F910}");
    }
  },
});
