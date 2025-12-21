import type { Message } from "discord.js";
import { detectCommit } from "../../utils/commit-detection";
import { COMMIT_OVERFLOW_FORUM_ID, COMMIT_PENDING_EMOJI } from "../../utils/consts";

export default async function handler(message: Message): Promise<void> {
	if (message.author.bot) return;

	if (!message.channel.isThread()) return;

	if (message.channel.parentId !== COMMIT_OVERFLOW_FORUM_ID) return;

	const detectedCommit = detectCommit(message);
	if (!detectedCommit) return;

	try {
		await message.react(COMMIT_PENDING_EMOJI);
	} catch (error) {
		console.error("Error reacting to potential commit:", error);
	}
}
