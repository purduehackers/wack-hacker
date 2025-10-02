import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import cowsay from "cowsay";
import textwrap from "@barudakrosul/textwrap";

const DEFAULT_WRAP_WIDTH = 40;

export const data = new SlashCommandBuilder()
	.setName("cowsay")
	.setDescription("Make a cow say it")
	.addStringOption((option) =>
		option
			.setName("text")
			.setDescription("The text to say")
			.setRequired(true),
	)
	.addStringOption((option) =>
		option
			.setName("cow")
			.setDescription("The cow design to use")
			.setRequired(false),
	)
	.addIntegerOption((option) =>
		option
			.setName("wrap_width")
			.setDescription(
				"Width at which to wrap the input text (0 to disable)",
			)
			.setRequired(false),
	);

export async function command(interaction: ChatInputCommandInteraction) {
	const { options } = interaction;

	const text = options.getString("text", true);
	const cow = options.getString("cow");
	const wrapWidth = options.getInteger("wrap_width") ?? DEFAULT_WRAP_WIDTH;

	const isChannel = !!interaction.channel;

	if (!isChannel) {
		await interaction.reply({
			content: "This command can only be used in a channel",
			ephemeral: true,
		});
		return;
	}

	if (text === "!list") {
		for (const chunk of await getCowListResponseContent()) {
			await interaction.reply({
				content: chunk,
				ephemeral: true,
			});
		}
	} else {
		let content = getCowsayResponseContent(text, cow, wrapWidth);
		if (content.length > 2000) {
			content = `⚠️ Error: response is too long to fit in one message (${content.length} > 2000)`;
		}
		await interaction.reply({
			content,
		});
	}
}

function getCowsayResponseContent(
	text: string,
	cow: string | null,
	wrapWidth: number,
): string {
	const wrappedText =
		wrapWidth > 0 ? textwrap.wrap(text, wrapWidth).join("\n") : text;
	const cowsaid = cowsay.say({
		text: wrappedText,
		f: cow ?? undefined,
	});
	return "```\n" + cowsaid + "\n```";
}

async function getCowListResponseContent(): Promise<string[]> {
	try {
		const filenames = await cowsay.list(() => {});
		const cows = filenames.map((name) => name.replace(/\.cow$/, ""));
		const chunks = ["```\n"];
		for (const cow of cows) {
			if (chunks[chunks.length - 1].length + cow.length + 1 + 3 > 2000) {
				chunks[chunks.length - 1] += "```";
				chunks.push("```\n");
			}
			chunks[chunks.length - 1] += cow + "\n";
		}
		chunks[chunks.length - 1] += "```";
		return chunks;
	} catch (e) {
		const msg = (e as Error).message;
		console.error(`Error listing cows: ${msg}`);
		return ["Error listing cows"];
	}
}
