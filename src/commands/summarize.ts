import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { summarize } from "../utils/summarization";

dayjs.extend(relativeTime);

export const data = new SlashCommandBuilder()
	.setName("summarize")
	.setDescription("Summarize a specific topic from previously sent messages")
	.addStringOption((option) =>
		option
			.setName("topic")
			.setDescription("The topic to summarize (e.g. breakdancing)")
			.setRequired(true),
	)
	.addStringOption((option) =>
		option
			.setName("timeframe")
			.setDescription(
				"The timeframe of past messages to consider (e.g. 1 hour, 30 mins)",
			)
			.setRequired(false),
	);

export async function command(interaction: ChatInputCommandInteraction) {
	const { options } = interaction;

	const topic = options.getString("topic");
	const timeframe = options.getString("timeframe");

	if (!topic) {
		await interaction.reply("Please provide a topic to summarize");
		return;
	}

	const isChannel = interaction.channel;

	if (!isChannel) {
		await interaction.reply("This command can only be used in a channel");
		return;
	}

	await summarize(timeframe, topic, interaction);
}
