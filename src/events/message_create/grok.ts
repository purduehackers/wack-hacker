import { type Message, TextChannel } from "discord.js";
import { distance } from "fastest-levenshtein";
import { summarize } from "../../utils/summarization";

const ASSISTANT_TRIGGER = "grok";
const SUMMARIZE_TRIGGER = "summary";

export default async function handler(message: Message) {
	if (message.author.bot) return;
	if (message.channel.isDMBased()) return;
	if (!(message.channel instanceof TextChannel)) return;

	// message.startThread(options);

	const result = message.content.replace(/\s+/g, " ").trim();
	const parts = result.split(" ");

	if (parts.length < 2 || !parts[0].startsWith("@")) return;

	const [ref, invocation, ...time1] = parts;

	const isThisReal = message.content.match(/is\s+this\s+real/);
	const time = isThisReal ? time1.slice(2) : time1;

	const refs = ref.substring(1);
	if (distance(ASSISTANT_TRIGGER, refs) > 3) return;

	if (distance(SUMMARIZE_TRIGGER, invocation) > 5 && !isThisReal) return;

	await summarize(
		time.length > 0 ? time.join(" ") : null,
		null,
		message as Message<true>,
	);
}
