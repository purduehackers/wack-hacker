import type { Message } from "discord.js";
import { env } from "../../env";
import { detectCommit } from "../../utils/commit-detection";
import { COMMIT_OVERFLOW_FORUM_ID, COMMIT_PENDING_EMOJI } from "../../utils/consts";

export default async function handler(message: Message): Promise<void> {
	if (env.COMMIT_OVERFLOW_ENABLED !== "1") return;
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
