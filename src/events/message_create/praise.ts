import { type Message, TextChannel, ChannelType } from "discord.js";
import { WACKY_ROLE_ID } from "../../utils/consts";

const ENABLE_PATTERN = /wackity\s+hackity\s+praise\s+me/;
const DISABLE_PATTERN = /wackity\s+hackity\s+go\s+away/;

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
		if (message.content.match(ENABLE_PATTERN)) {
			await message.member!.roles.add(WACKY_ROLE_ID);
			await message.react("🥳");
		} else if (message.content.match(DISABLE_PATTERN)) {
			await message.member!.roles.remove(WACKY_ROLE_ID);
			await message.react("🤐");
		}
	} catch (e) {
		console.error(e);
	}
}
