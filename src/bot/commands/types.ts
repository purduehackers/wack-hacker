import type { API } from "@discordjs/core/http-only";
import type {
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

import type { DiscordInteraction } from "@/lib/protocol/types";

export type CommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface SlashCommandContext {
  interaction: DiscordInteraction;
  discord: API;
  options: Map<string, string | number | boolean>;
}

export interface SlashCommand {
  name: string;
  builder: CommandBuilder;
  execute(ctx: SlashCommandContext): Promise<void>;
}
