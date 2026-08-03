/**
 * Slash command authoring and dispatch.
 *
 * Much smaller than the legacy equivalent, because a gateway app gets
 * `INTERACTION_CREATE` over the WebSocket. There is no signature to verify, no
 * 3-second ACK deadline to defer around, and no `waitUntil` to keep work alive
 * past an HTTP response — so `parseOptions`, the flat option `Map`, and the
 * modal-versus-defer special case are all gone. Handlers use discord.js's typed
 * option accessors directly.
 *
 * `execute` returns a `Result` rather than throwing. That is what lets the
 * dispatcher classify every failure the same way and guarantee the user always
 * gets a reply — the legacy dispatcher's worst failure mode was a command that
 * threw after deferring, leaving "thinking…" forever.
 */

import type { KnownError } from "@repo/shared/errors";
import type { Result } from "@repo/shared/result";
import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { SlashCommandBuilder } from "discord.js";

/** Any builder shape that can be serialized for registration. */
export type CommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface SlashCommand {
  readonly builder: CommandBuilder;
  readonly execute: (interaction: ChatInputCommandInteraction) => Promise<Result<void, KnownError>>;
}

/** Identity, but it pins the shape so a malformed command fails at authoring. */
export function defineCommand(command: SlashCommand): SlashCommand {
  return command;
}

export function commandName(command: SlashCommand): string {
  return command.builder.name;
}

export function toRegistrationBody(
  command: SlashCommand,
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return command.builder.toJSON();
}
