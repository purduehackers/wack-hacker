/** `/phack` creates a short redirect on phack.rs for an organizer. */

import { UserRole, roleAtLeast } from "@repo/shared/discord";
import { Forbidden } from "@repo/shared/errors";
import { PHACK_RESERVED_SLUGS, PHACK_SLUG_PATTERN } from "@repo/shared/phack";
import { Result } from "@repo/shared/result";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import type { SlashCommand } from "../framework/commands.ts";
import type { CreateLinkError, PhackLinkWriter } from "../integrations/phack-links.ts";
import { roleOf } from "../utils/roles.ts";

const RANDOM_SLUG_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_SLUG_LENGTH = 8;
const MAX_RANDOM_SLUG_ATTEMPTS = 5;

export const builder = new SlashCommandBuilder();
builder
  .setName("phack")
  .setDescription("Create a phack.rs short link (organizers only)")
  .addStringOption((option) =>
    option
      .setName("destination")
      .setDescription("Full destination URL, starting with https://")
      .setRequired(true)
      .setMaxLength(2048),
  )
  .addStringOption((option) =>
    option
      .setName("slug")
      .setDescription("Optional short path; defaults to a random 8-character code")
      .setRequired(false)
      .setMaxLength(64),
  );

function destinationFrom(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function randomSlug(): string {
  let slug = "";
  while (slug.length < RANDOM_SLUG_LENGTH) {
    const sample = crypto.getRandomValues(new Uint8Array(RANDOM_SLUG_LENGTH - slug.length));
    for (const byte of sample) {
      // Reject the top four values so each character has equal probability.
      if (byte < 252) slug += RANDOM_SLUG_CHARACTERS.charAt(byte % RANDOM_SLUG_CHARACTERS.length);
    }
  }
  return slug;
}

async function run(
  interaction: ChatInputCommandInteraction,
  writer: PhackLinkWriter,
): Promise<Result<string, Forbidden | CreateLinkError>> {
  const role = roleOf(interaction);
  if (!roleAtLeast(role, UserRole.Organizer)) {
    return Result.err(
      new Forbidden({ required: UserRole.Organizer, actual: role, subject: "/phack" }),
    );
  }

  const destination = destinationFrom(interaction.options.getString("destination", true).trim());
  if (destination === undefined) {
    return Result.ok("Enter a full https:// URL without embedded credentials.");
  }

  const providedSlug = interaction.options.getString("slug")?.trim();
  if (
    providedSlug !== undefined &&
    (!PHACK_SLUG_PATTERN.test(providedSlug) || PHACK_RESERVED_SLUGS.has(providedSlug.toLowerCase()))
  ) {
    return Result.ok(
      "Use 2–64 letters, numbers, or hyphens, starting and ending with a letter or number.",
    );
  }

  const attempts = providedSlug === undefined ? MAX_RANDOM_SLUG_ATTEMPTS : 1;
  for (let index = 0; index < attempts; index++) {
    const slug = providedSlug ?? randomSlug();
    const created = await writer.create(slug, destination);
    if (Result.isError(created)) return created;
    if (created.value === "created") {
      return Result.ok(
        `Created https://phack.rs/${slug} — it may take a few seconds to start redirecting.`,
      );
    }
    if (created.value === "same") {
      return Result.ok(`https://phack.rs/${slug} already points to that destination.`);
    }
    if (providedSlug !== undefined) {
      return Result.ok(`https://phack.rs/${slug} already exists. Choose another slug.`);
    }
  }
  return Result.ok("Could not find an unused random slug. Try again.");
}

export function phackCommand(writer: PhackLinkWriter): SlashCommand {
  return {
    builder,
    execute: async (interaction) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const outcome = await run(interaction, writer);
      if (Result.isError(outcome)) return outcome;
      await interaction.editReply(outcome.value);
      return Result.ok(undefined);
    },
  };
}
