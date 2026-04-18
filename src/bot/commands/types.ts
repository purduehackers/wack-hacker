import type { API } from "@discordjs/core/http-only";
import type {
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

import type { DiscordInteraction } from "@/lib/protocol/types";

export type CommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | ContextMenuCommandBuilder;

export interface SlashCommandContext {
  interaction: DiscordInteraction;
  discord: API;
  options: Map<string, string | number | boolean>;
}

export interface SlashCommand {
  name: string;
  builder: CommandBuilder;
  /** When true, defer the interaction response with the Ephemeral flag so only the invoker sees it. */
  ephemeral?: boolean;
  execute(ctx: SlashCommandContext): Promise<void>;
}
