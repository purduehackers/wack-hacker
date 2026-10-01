/** `/phack` creates a short redirect on phack.rs for an organizer. */

import { UserRole, roleAtLeast } from "@repo/shared/discord";
import { Forbidden } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import type { SlashCommand } from "../framework/commands.ts";
import type { CreateLinkError, PhackLinkWriter } from "../integrations/phack-links.ts";
import { roleOf } from "../utils/roles.ts";

const RESERVED_SLUGS = new Set(["404", "api", "dashboard", "favicon", "login"]);
const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}[a-zA-Z0-9]$/u;

export const builder = new SlashCommandBuilder();
builder
  .setName("phack")
  .setDescription("Create a phack.rs short link (organizers only)")
  .addStringOption((option) =>
    option
      .setName("slug")
      .setDescription("Short path, such as hack-night")
      .setRequired(true)
      .setMaxLength(64),
  )
  .addStringOption((option) =>
    option
      .setName("destination")
      .setDescription("Full destination URL, starting with https://")
      .setRequired(true)
      .setMaxLength(2048),
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

function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug.toLowerCase());
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

  const slug = interaction.options.getString("slug", true).trim();
  if (!isValidSlug(slug)) {
    return Result.ok(
      "Use 2–64 letters, numbers, or hyphens, starting and ending with a letter or number.",
    );
  }

  const created = await writer.create(slug, destination);
  if (Result.isError(created)) return created;
  if (created.value === "exists") {
    return Result.ok(`https://phack.rs/${slug} already exists. Choose another slug.`);
  }
  if (created.value === "same") {
    return Result.ok(`https://phack.rs/${slug} already points to that destination.`);
  }
  return Result.ok(
    `Created https://phack.rs/${slug} — it may take a few seconds to start redirecting.`,
  );
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
