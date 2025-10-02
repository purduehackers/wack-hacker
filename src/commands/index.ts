import type {
	ChatInputCommandInteraction,
	SlashCommandOptionsOnlyBuilder,
} from "discord.js";

import * as summarize from "./summarize";
import * as cowsay from "./cowsay";

type Command = {
	data: SlashCommandOptionsOnlyBuilder;
	command: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export const commands: Command[] = [summarize, cowsay];
