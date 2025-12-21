import type {
	ChatInputCommandInteraction,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

import * as commitOverflow from "./commit-overflow";
import * as summarize from "./summarize";

type Command = {
	data: SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
	command: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export const commands: Command[] = [summarize, commitOverflow];
