/**
 * `/privacy` — control whether Wack Hacker publishes your content.
 *
 * Every reply is ephemeral: asking a privacy question must not broadcast the
 * answer to the channel.
 *
 * The command is self-scoped by construction — the user id comes from the
 * interaction, never from an option — so there is no way to read or change
 * someone else's setting and therefore no role gate to get wrong.
 *
 * One toggle, not a mode enum. The thing a person actually wants to say is
 * "don't put my stuff on the internet", and the previous three modes plus
 * per-project overrides expressed distinctions nobody was making — while the
 * gate itself was never wired up, so none of it had any effect.
 */

import { Transient } from "@repo/shared/errors";
import { isOptedOut, optIn, optOut } from "@repo/shared/privacy";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import type { SlashCommand } from "../framework/commands.ts";

/**
 * What opting out does and does not do.
 *
 * It is forward-looking only. Saying so is the honest version — the previous
 * command promised a permanent cross-project deletion that was carried out by
 * an unretried fan-out whose failures were never read.
 */
const OPTED_OUT_NOTICE =
  "You are **opted out**. Wack Hacker will not mirror your messages, ships, or photos " +
  "outside Discord.\n\nThis applies going forward. Anything already public stays until " +
  "someone removes it — ask an organizer if you need that.";

const OPTED_IN_NOTICE =
  "You are **opted in**, the default. Wack Hacker may mirror your messages, ships, and " +
  "photos to Purdue Hackers' public sites.";

export const builder = new SlashCommandBuilder();
builder
  .setName("privacy")
  .setDescription("Control whether Wack Hacker publishes your content outside Discord")
  .addSubcommand((sub) =>
    sub.setName("view").setDescription("Show whether you are opted in or out"),
  )
  .addSubcommand((sub) =>
    sub.setName("opt-out").setDescription("Stop Wack Hacker publishing your content"),
  )
  .addSubcommand((sub) =>
    sub.setName("opt-in").setDescription("Allow Wack Hacker to publish your content again"),
  );

async function run(
  interaction: ChatInputCommandInteraction,
  redis: RedisClient,
): Promise<Result<string, Transient>> {
  const userId = interaction.user.id;

  return Result.tryPromise({
    try: async () => {
      switch (interaction.options.getSubcommand()) {
        case "opt-out": {
          await optOut(redis, userId);
          return OPTED_OUT_NOTICE;
        }
        case "opt-in": {
          await optIn(redis, userId);
          return OPTED_IN_NOTICE;
        }
        default:
          return (await isOptedOut(redis, userId)) ? OPTED_OUT_NOTICE : OPTED_IN_NOTICE;
      }
    },
    catch: (cause) =>
      new Transient({
        operation: "read or write privacy preference",
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}

export function privacyCommand(redis: RedisClient) {
  return {
    builder,
    execute: async (interaction) => {
      // Preferences are personal, so nothing here is posted publicly.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const outcome = await run(interaction, redis);
      if (Result.isError(outcome)) return Result.err(outcome.error);

      await interaction.editReply(outcome.value);
      return Result.ok(undefined);
    },
  } satisfies SlashCommand;
}
