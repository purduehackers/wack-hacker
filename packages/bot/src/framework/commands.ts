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
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

export interface SlashCommand {
  readonly builder: SlashCommandBuilder;
  readonly execute: (interaction: ChatInputCommandInteraction) => Promise<Result<void, KnownError>>;
  /**
   * Fills an option marked `setAutocomplete(true)`.
   *
   * Optional because most options have nothing to suggest, and separate from
   * `execute` because Discord sends it as its own interaction — one per
   * keystroke, three seconds to answer, and no way to reply to the person if it
   * fails. A handler that cannot answer should respond with no choices rather
   * than raise, which leaves the typed text exactly as it is.
   */
  readonly autocomplete?: (
    interaction: AutocompleteInteraction,
  ) => Promise<Result<void, KnownError>>;
}
