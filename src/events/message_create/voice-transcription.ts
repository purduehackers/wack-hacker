import { type Message, MessageFlags } from "discord.js";
import Groq from "groq-sdk";

import { env } from "../../env";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export default async function handler(message: Message) {
	if (message.author.bot) return;
	if (message.channel.isDMBased()) return;
	if (!message.flags.has(MessageFlags.IsVoiceMessage)) return;

	await message.react("🎙️");

	const audioFile = message.attachments.find(
		(m) => m.name === "voice-message.ogg",
	);
	if (!audioFile) return;

	const file = await fetch(audioFile.url);

	const response = await groq.audio.transcriptions.create({
		file,
		model: "whisper-large-v3",
		language: "en",
	});

	if (!response.text) {
		await message.reply({
			content: "Sorry, I couldn't transcribe that audio message.",
		});
		return;
	}

	await message.reply({
		content: response.text.trim(),
	});
}
