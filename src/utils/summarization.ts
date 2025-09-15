import dayjs from "dayjs";
import {
	ChatInputCommandInteraction,
	type Message,
	MessageFlags,
	type PublicThreadChannel,
	type TextChannel,
} from "discord.js";
import Groq from "groq-sdk";
import human from "human-interval";
import { env } from "../env";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export async function summarize(
	timeframe: string | null,
	top: string | null,
	replyable: Message<true> | ChatInputCommandInteraction,
) {
	const timeframeMs = human(timeframe ?? "1 hour");
	const topic =
		top || "whatever the most common theme of the previous messages is";
	const displayTopic = top || "WHATEVER";

	if (!timeframeMs) {
		await replyable.reply("Invalid timeframe provided");
		return;
	}

	const date = new Date(Date.now() - timeframeMs);
	const formatted = dayjs(date).fromNow();

	if (replyable instanceof ChatInputCommandInteraction) {
		await replyable.reply({
			content: `Summarizing messages related to ${topic} from ${formatted}.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	const snowflake = (
		(BigInt(date.valueOf()) - BigInt(1420070400000)) <<
		BigInt(22)
	).toString();

	const channel = replyable.channel as TextChannel;

	const messages = await channel.messages.fetch({
		limit: 100,
		after: snowflake,
	});

	const corpus = messages
		.reverse()
		.map(
			(message) =>
				`[${message.author.displayName} ${new Date(message.createdTimestamp).toISOString()}] ${message.content}`,
		)
		.join("\n");

	const systemPrompt = `
You are Wack Hacker, an expert Discord conversation analyst.
Your goal is to produce a precise, useful, and safe summary for a Discord thread.

Constraints and style:
- Focus ONLY on the specified topic. Ignore unrelated chatter.
- Never @mention users. Refer to people by their visible username only (e.g., "Ray said …").
- Treat each line of the corpus as: "[<username> <ISO timestamp>] <message text>".
- Quote sparingly (short, relevant snippets only) and use proper Discord Markdown.
- Prefer bullets over prose; keep sentences crisp and factual.
- Do not invent details. If information is missing or uncertain, say so explicitly.
- If there’s nothing relevant to the topic, output: "No relevant messages about **<TOPIC>** in this timeframe."
- Keep the whole output under ~1,800 characters when possible; split logically if longer is unavoidable.

What to extract (if present):
- Concrete points relevant to the topic
- Decisions made (who decided, what, when)
- Action items (owner → task → any deadline)
- Open questions / blockers
- Notable links, files, or code references
- Divergences or disagreements

Output format (strict):
# Summary — <TOPIC>
- <key point 1>
- <key point 2>
  - (speaker: USERNAME, at ISO_TIME)

## Decisions
- <decision> (by USERNAME at ISO_TIME)

## Action Items
- USERNAME → <task> (due: <date/relative> if any)

## Open Questions
- <question> (raised by USERNAME at ISO_TIME)

## Notable Quotes
- "short quote" — USERNAME at ISO_TIME
`.trim();

	// Build the user message that carries data + task
	const userPrompt = `
MESSAGES SINCE: ${formatted} (ISO start: ${new Date(date).toISOString()})
TOPIC: ${topic}

CORPUS (one per line):
${corpus}

TASK:
Using ONLY the corpus above, produce the requested output format focusing strictly on **${topic}**.
- Include usernames and ISO timestamps in parentheses where helpful.
- Follow Discord Markdown rules.
- Do not include any content not present in the corpus.
`.trim();

	// Then call the model with both messages:
	const response = await groq.chat.completions.create({
		model: "openai/gpt-oss-120b",
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		],
	});

	const thread = (await channel.threads.create({
		name: `Summary of ${displayTopic} from ${formatted}`,
		autoArchiveDuration: 60,
		reason: `Summarizing messages related to ${displayTopic} from ${formatted}.`,
	})) as PublicThreadChannel<false>;

	const message = response.choices[0].message;

	if (!message.content) {
		console.error("No content");
		await thread.send("Error: No content");
		return;
	}

	if (message.content.length > 2000) {
		const chunks = message.content.match(/[\s\S]{1,2000}/g);

		if (!chunks) {
			console.error("No chunks");
			await thread.send("Error: No chunks");
			return;
		}

		for (const chunk of chunks) {
			console.log(chunk);
			await thread.send(chunk);
		}
	} else {
		await thread.send(message.content);
	}
}
