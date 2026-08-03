/**
 * `/hack-night` — set up or reset the weekly hack night.
 *
 * Merges the legacy `/init-hn` and `/reset-hn` into one command with `start` and
 * `reset` subcommands. They only ever differed by which emoji they wrote and
 * whether they bumped the dashboard version, which is a subcommand, not two
 * commands.
 *
 * Organizer-gated. The check reads the member's live roles off the interaction,
 * so it reflects the caller's roles right now rather than anything cached.
 *
 * The two side effects are deliberately ordered: rename the channel first, bump
 * the dashboard version second. A failed rename leaves the version untouched,
 * which is recoverable by re-running. The reverse order would advertise a hack
 * night the Discord channel does not reflect.
 */

import { DISCORD_IDS, UserRole, roleAtLeast } from "@repo/shared/discord";
import { Forbidden, InvalidInput, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { defineCommand } from "../framework/commands.ts";
import { roleOf } from "../utils/roles.ts";

/** 🌙 — the channel's resting state between hack nights. */
const DEFAULT_EMOJI = "\u{1F319}";

export type HackNightError = Forbidden | InvalidInput | Transient | UpstreamError;

/**
 * Swaps the leading emoji, leaving the rest of the channel name alone.
 *
 * Only one leading pictographic character is stripped, so a name that never had
 * a prefix simply gains one and repeated runs do not accumulate emoji.
 */
export function withEmojiPrefix(currentName: string, emoji: string): string {
  return `${emoji}${currentName.replace(/^\p{Extended_Pictographic}/u, "")}`;
}

/**
 * A single emoji, nothing else.
 *
 * Discord accepts almost anything in a channel name, so an unchecked value here
 * would let a typo rename the busiest channel in the server to arbitrary text.
 */
export function isSingleEmoji(value: string): boolean {
  return /^\p{Extended_Pictographic}$/u.test(value);
}

/** Semver-ish, matching the dashboard's own expectation (for example `6.17`). */
export function isVersionString(value: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(value);
}

export interface DashboardWriter {
  readonly setVersion: (version: string) => Promise<Result<undefined, HackNightError>>;
}

export const builder = new SlashCommandBuilder()
  .setName("hack-night")
  .setDescription("Set up or reset hack night (organizers only)")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start hack night: set the channel emoji and bump the dashboard version")
      .addStringOption((opt) =>
        opt
          .setName("emoji")
          .setDescription("The emoji to use as the channel prefix")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("version")
          .setDescription("The version string shown on the dashboard (e.g. 6.17)")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("reset").setDescription("Reset the channel prefix back to the moon emoji"),
  );

/** Renames the hack night channel, returning the new name. */
async function renameChannel(
  interaction: ChatInputCommandInteraction,
  emoji: string,
): Promise<Result<string, HackNightError>> {
  return Result.tryPromise({
    try: async () => {
      const channel = await interaction.client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
      // A falsy check rather than an explicit null comparison: discord.js
      // reports "no such channel" as null, and a channel object is never falsy.
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        throw new UpstreamError({
          service: "discord",
          status: 404,
          detail: "hack night channel is not a guild text channel",
        });
      }

      const renamed = await channel.setName(withEmojiPrefix(channel.name, emoji));
      return renamed.name;
    },
    catch: (cause) =>
      cause instanceof UpstreamError
        ? cause
        : new Transient({
            operation: "rename hack night channel",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
  });
}

async function run(
  interaction: ChatInputCommandInteraction,
  dashboard: DashboardWriter,
): Promise<Result<string, HackNightError>> {
  // Live roles from the interaction, never a cached snapshot.
  const role = roleOf(interaction);
  if (!roleAtLeast(role, UserRole.Organizer)) {
    return Result.err(
      new Forbidden({ required: UserRole.Organizer, actual: role, subject: "/hack-night" }),
    );
  }

  if (interaction.options.getSubcommand() === "reset") {
    return Result.map(
      await renameChannel(interaction, DEFAULT_EMOJI),
      (name) => `Hack night reset. Channel is now **${name}**.`,
    );
  }

  const emoji = interaction.options.getString("emoji", true);
  const version = interaction.options.getString("version", true);

  if (!isSingleEmoji(emoji)) {
    return Result.err(
      new InvalidInput({ subject: "emoji", issues: [`"${emoji}" is not a single emoji`] }),
    );
  }
  if (!isVersionString(version)) {
    return Result.err(
      new InvalidInput({ subject: "version", issues: [`"${version}" is not like 6.17`] }),
    );
  }

  const renamed = await renameChannel(interaction, emoji);
  if (Result.isError(renamed)) return renamed;

  // Second, so a failed rename never advertises a hack night the channel does
  // not reflect. Re-running the command is safe.
  const bumped = await dashboard.setVersion(version);
  if (Result.isError(bumped)) return bumped;

  return Result.ok(
    `Hack night started.\n- Channel: **${renamed.value}**\n- Version: **${version}**`,
  );
}

export function hackNightCommand(dashboard: DashboardWriter) {
  return defineCommand({
    builder,
    execute: async (interaction) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const outcome = await run(interaction, dashboard);
      if (Result.isError(outcome)) return Result.err(outcome.error);

      await interaction.editReply(outcome.value);
      return Result.ok(undefined);
    },
  });
}
