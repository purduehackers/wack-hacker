import { type Message, TextChannel, ChannelType } from "discord.js";
import { WACKY_ROLE_ID } from "../../utils/consts";

const ENABLE_PATTERNS = [
  /wackity\s+hackity\s+praise\s+me/,
  /clanke+r+\s+go\s+away/,
];
const DISABLE_PATTERNS = [
  /wackity\s+hackity\s+go\s+away/,
  /clanke+r+\s+praise\s+me/,
];

export default async function handler(message: Message) {
	if (message.author.bot) return;
	if (
		!(
			message.channel.type == ChannelType.GuildText ||
			message.channel.type == ChannelType.PublicThread
		)
	)
		return;
	if (message.member === null) return;

  try {
    for (const enable_pattern of ENABLE_PATTERNS) {
      if (message.content.match(enable_pattern)) {
        await message.member!.roles.add(WACKY_ROLE_ID);
        await message.react("🥳");
        return;
      }
    }

    for (const disable_pattern of DISABLE_PATTERNS) {
      if (message.content.match(disable_pattern)) {
        await message.member!.roles.remove(WACKY_ROLE_ID);
        await message.react("🤐");
        return;
      }
    }
  } catch (e) {
    console.error(e);
  }
}
