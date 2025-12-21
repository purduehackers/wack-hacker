import type {
	ChatInputCommandInteraction,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

import { env } from "../env";
import * as commitOverflow from "./commit-overflow";
import * as summarize from "./summarize";

type Command = {
	data: SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
	command: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const baseCommands: Command[] = [summarize];

if (env.COMMIT_OVERFLOW_ENABLED === "1") {
	baseCommands.push(commitOverflow);
}

export const commands: Command[] = baseCommands;
