/**
 * Slash command authoring and dispatch.
 *
 * Much smaller than the prior equivalent, because a gateway app gets
 * `INTERACTION_CREATE` over the WebSocket. There is no signature to verify, no
 * 3-second ACK deadline to defer around, and no `waitUntil` to keep work alive
 * past an HTTP response — so `parseOptions`, the flat option `Map`, and the
 * modal-versus-defer special case are all gone. Handlers use discord.js's typed
 * option accessors directly.
 *
 * `execute` returns a `Result` rather than throwing. That is what lets the
 * dispatcher classify every failure the same way and guarantee the user always
 * gets a reply — the prior dispatcher's worst failure mode was a command that
 * threw after deferring, leaving "thinking…" forever.
 */

import type { KnownError } from "@repo/shared/errors";
import type { Result } from "@repo/shared/result";
import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export interface SlashCommand {
  readonly builder: SlashCommandBuilder;
  readonly execute: (interaction: ChatInputCommandInteraction) => Promise<Result<void, KnownError>>;
}
