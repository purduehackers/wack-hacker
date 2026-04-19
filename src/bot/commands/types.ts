import type { API } from "@discordjs/core/http-only";
import type {
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

import type { InteractionResponseType } from "@/lib/protocol/constants";
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

export interface InteractionResponsePayload {
  type: InteractionResponseType;
  data?: unknown;
}

export interface SlashCommand {
  name: string;
  builder: CommandBuilder;
  /** When true, defer the interaction response with the Ephemeral flag so only the invoker sees it. */
  ephemeral?: boolean;
  /**
   * When true, the dispatcher does NOT auto-defer. `execute` runs synchronously
   * and its returned `InteractionResponsePayload` becomes the HTTP response —
   * required for commands that open a modal, since Discord forbids showing a
   * modal after a deferred response.
   */
  modal?: boolean;
  execute(ctx: SlashCommandContext): Promise<InteractionResponsePayload | void>;
}
