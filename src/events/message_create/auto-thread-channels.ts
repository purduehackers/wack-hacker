// loosely based on https://github.com/hackclub/scrappy
import { setTimeout } from "node:timers/promises";
import type { Message } from "discord.js";
import { WACKY_ROLE_ID } from "../../utils/consts";

const SHIP_CHANNEL_ID = "904896819165814794";
const CHECKPOINTS_CHANNEL_ID = "1052236377338683514";

const AUTO_THREAD_CHANNELS = [SHIP_CHANNEL_ID, CHECKPOINTS_CHANNEL_ID];
// TODO(@rayhanadev): this is honestly shitty but breaks less
// than requiring people to add an image like Scrappy does. Look
// into phasing this out or doing something different.
// const VALID_PROJECT_LINKS = ["https://github.com/"];

const CHECKPOINT_RESPONSE_MESSAGES = [
	"Great checkpoint! :D",
	"Nice progress! :D",
	"Awesome update! :D",
	"Yay thanks for sharing! :D",
	"Yippie!! Keep it up! :D",
	"Who up checking they point?",
];

const SHIP_RESPONSE_MESSAGES = [
	"Congrats on shipping! :D",
	"You shipped it! :D",
	"That’s a wrap! :D",
	"Yay thanks for sharing! :D",
	"Yippie!! Great work! :D",
	"Launched and loved! :D",
	"Woohoo, it's live now! :D",
	"Done and dusted! :D",
	"High-five on the ship! :D",
	"Boom, nice ship! :D",
];

export default async function handler(message: Message) {
	if (message.author.bot) return;
	if (message.channel.isDMBased()) return;

	if (!AUTO_THREAD_CHANNELS.includes(message.channelId)) return;

	const hasProjectLink = containsValidProjectLink(message.content);
	const hasAttachment = message.attachments.size > 0;
	const isSIGHORSECheckpoint = message.reference
		? await message.fetchReference().then((ref) => {
				if (ref.channel.isDMBased()) return false;
				if (ref.channel.parentId === "1381412394676518932") return true;
				return false;
			})
		: false;

	if (!hasProjectLink && !hasAttachment && !isSIGHORSECheckpoint) {
		await message.delete();
		const reminderMessage = `Hey there, it looks like you tried to send a message in <#${message.channelId}> without an attachment or URL!! D:

It's okay!! I saved your message for you!! 🙂‍↕️

\`\`\`
${message.content}
\`\`\`

- If you meant to reply to someone, send your message in the corresponding thread!
- If you meant checkpoint or ship a project, add an attachment or URL so people can see your work :D
- If you think this action was done in error, ping <@636701123620634653> and let them know!

Cheers! ^•^`;

		await message.author.send(reminderMessage);
		return;
	}

	// TODO(@rayhanadev): use groq to generate title?

	// NOTE: legacy title generation, `{displayName}'s <ship|checkpoint>`
	// NOTE: add a condition when updating AUTO_THREAD_CHANNELS
	// const type =
	//   message.channelId === CHECKPOINTS_CHANNEL_ID
	//     ? "checkpoint"
	//     : message.channelId === SHIP_CHANNEL_ID
	//       ? "ship"
	//       : "something???";
	// const thread = await message.startThread({
	//   name: `${message.author.displayName}'s ${type}!`,
	// });

	await setTimeout(1000);

	const thread = await message.startThread({
		name: `${message.author.displayName} - ${message.cleanContent.slice(0, 54)}`,
	});

	if (message.channelId === CHECKPOINTS_CHANNEL_ID) {
		if (message.member?.roles.cache.has(WACKY_ROLE_ID)) {
			await Promise.all([
				message.react("🎉"),
				message.react("✨"),
				message.react("🏁"),
				thread.send(
					`${CHECKPOINT_RESPONSE_MESSAGES[
						Math.floor(Math.random() * CHECKPOINT_RESPONSE_MESSAGES.length)
					]} 🎉 ✨ 🏁`,
				),
			]);
		}
		// TODO(@rayhanadev): integrate potential scrapbook
		// TODO(@rayhanadev): add auto-emoji behavior
	}

	if (message.channelId === SHIP_CHANNEL_ID) {
		if (message.member?.roles.cache.has(WACKY_ROLE_ID)) {
			await Promise.all([
				message.react("🎉"),
				message.react("✨"),
				message.react("🚀"),
				thread.send(
					`${
						SHIP_RESPONSE_MESSAGES[
							Math.floor(Math.random() * SHIP_RESPONSE_MESSAGES.length)
						]
					} 🎉 ✨ 🚀`,
				),
			]);
		}

		// TODO(@rayhanadev): integrate potential scrapbook
		// TODO(@rayhanadev): add auto-emoji behavior
		// TODO(@rayhanadev): add hook for SIGHORSE
	}

	await thread.setArchived(true);
}

const urlPattern = /https?:\/\/\S+/i;

function containsValidProjectLink(text: string): boolean {
	// NOTE: legacy behavior
	// return VALID_PROJECT_LINKS.some((host) => text.includes(host));
	return urlPattern.test(text);
}
