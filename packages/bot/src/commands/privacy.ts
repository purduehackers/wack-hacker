/**
 * `/privacy` — manage your own privacy preferences.
 *
 * Ported from the legacy command with its subcommands and copy intact, plus one
 * correction: every reply is **ephemeral**. The legacy version replied publicly,
 * which meant asking a privacy question broadcast the answer to the channel.
 * That is the one behaviour change here, and it is a fix rather than a
 * preference.
 *
 * The command is self-scoped by construction — the user id comes from the
 * interaction, never from an option — so there is no way to read or change
 * someone else's preferences and therefore no role gate to get wrong.
 */

import { InvalidInput } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import {
  MODE_LABELS,
  PROJECT_LABELS,
  PrivacyMode,
  PrivacyProject,
  isPrivacyMode,
  isPrivacyProject,
} from "../integrations/privacy.ts";
import type { PrivacyClient, PrivacyError } from "../integrations/privacy.ts";
import { defineCommand } from "./define.ts";

const MODE_CHOICES = [
  { name: MODE_LABELS[PrivacyMode.OptIn], value: PrivacyMode.OptIn },
  { name: MODE_LABELS[PrivacyMode.OptOutPrivacy], value: PrivacyMode.OptOutPrivacy },
  { name: MODE_LABELS[PrivacyMode.OptOutCollection], value: PrivacyMode.OptOutCollection },
] as const;

const PROJECT_CHOICES = [
  { name: PROJECT_LABELS[PrivacyProject.CommitOverflow], value: PrivacyProject.CommitOverflow },
  { name: PROJECT_LABELS[PrivacyProject.Ships], value: PrivacyProject.Ships },
] as const;

/** Labels an unknown value rather than rendering `undefined` at the user. */
function modeLabel(mode: string): string {
  return isPrivacyMode(mode) ? MODE_LABELS[mode] : mode;
}

function projectLabel(project: string): string {
  return isPrivacyProject(project) ? PROJECT_LABELS[project] : project;
}

/** Turns an off-contract option value into a typed failure. */
function badOption(name: string, value: string): InvalidInput {
  return new InvalidInput({
    subject: `/privacy ${name} option`,
    issues: [`unrecognized value "${value}"`],
  });
}

export function renderPreferences(preferences: {
  readonly mode: string;
  readonly overrides: Readonly<Record<string, string>>;
}): string {
  const entries = Object.entries(preferences.overrides);
  const overrides =
    entries.length === 0
      ? "None"
      : entries.map(([p, m]) => `**${projectLabel(p)}**: ${modeLabel(m)}`).join("\n");

  return [
    "**Your Privacy Preferences**",
    "",
    `**Global Mode:** ${modeLabel(preferences.mode)}`,
    "**Project Overrides:**",
    overrides,
  ].join("\n");
}

/**
 * Copy for a completed global-mode change.
 *
 * Opt-out-of-collection is destructive and irreversible, so it says so and
 * points at the non-destructive alternative — carried over verbatim, because it
 * is the one place this command can cause data loss.
 */
export function globalModeNotice(mode: PrivacyMode): string {
  const base = `Your global privacy mode has been set to **${MODE_LABELS[mode]}**.`;
  if (mode !== PrivacyMode.OptOutCollection) return base;

  return (
    `${base}\n\n` +
    "**Warning:** This will permanently delete all your data across all Purdue Hackers projects. " +
    "If you want to hide your data but keep it, use `/privacy set` with " +
    "**Opt Out (hidden, data kept)** instead."
  );
}

export const builder = new SlashCommandBuilder()
  .setName("privacy")
  .setDescription("Manage your privacy preferences across Purdue Hackers projects")
  .addSubcommand((sub) =>
    sub.setName("view").setDescription("View your current privacy preferences"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Set your global privacy mode")
      .addStringOption((opt) =>
        opt
          .setName("mode")
          .setDescription("Your privacy mode")
          .setRequired(true)
          .addChoices(...MODE_CHOICES),
      )
      .addStringOption((opt) => opt.setName("reason").setDescription("Optional reason")),
  )
  .addSubcommand((sub) =>
    sub
      .setName("set-project")
      .setDescription("Override privacy for a specific project")
      .addStringOption((opt) =>
        opt
          .setName("project")
          .setDescription("The project")
          .setRequired(true)
          .addChoices(...PROJECT_CHOICES),
      )
      .addStringOption((opt) =>
        opt
          .setName("mode")
          .setDescription("Privacy mode")
          .setRequired(true)
          .addChoices(...MODE_CHOICES),
      )
      .addStringOption((opt) => opt.setName("reason").setDescription("Optional reason")),
  )
  .addSubcommand((sub) => sub.setName("reset").setDescription("Reset all preferences to default"))
  .addSubcommand((sub) =>
    sub
      .setName("reset-project")
      .setDescription("Remove a project override")
      .addStringOption((opt) =>
        opt
          .setName("project")
          .setDescription("The project to reset")
          .setRequired(true)
          .addChoices(...PROJECT_CHOICES),
      ),
  );

async function run(
  interaction: ChatInputCommandInteraction,
  client: PrivacyClient,
): Promise<Result<string, PrivacyError>> {
  const userId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "view": {
      const preferences = await client.getPreferences(userId);
      return Result.map(preferences, renderPreferences);
    }
    case "set": {
      const mode = interaction.options.getString("mode", true);
      if (!isPrivacyMode(mode)) return Result.err(badOption("mode", mode));

      const reason = interaction.options.getString("reason") ?? undefined;
      const updated = await client.setGlobalMode(userId, mode, reason);
      return Result.map(updated, () => globalModeNotice(mode));
    }
    case "set-project": {
      const project = interaction.options.getString("project", true);
      const mode = interaction.options.getString("mode", true);
      if (!isPrivacyProject(project)) return Result.err(badOption("project", project));
      if (!isPrivacyMode(mode)) return Result.err(badOption("mode", mode));

      const reason = interaction.options.getString("reason") ?? undefined;
      const updated = await client.setProjectOverride(userId, project, mode, reason);
      return Result.map(
        updated,
        () =>
          `Your privacy mode for **${PROJECT_LABELS[project]}** has been set to ` +
          `**${MODE_LABELS[mode]}**.`,
      );
    }
    case "reset": {
      const reset = await client.resetPreferences(userId);
      return Result.map(
        reset,
        () => "Your privacy preferences have been reset to the default (Opt In).",
      );
    }
    case "reset-project": {
      const project = interaction.options.getString("project", true);
      if (!isPrivacyProject(project)) return Result.err(badOption("project", project));

      const removed = await client.removeProjectOverride(userId, project);
      return Result.map(
        removed,
        () =>
          `Your override for **${PROJECT_LABELS[project]}** has been removed. ` +
          "It will now follow your global mode.",
      );
    }
    default:
      // Unreachable: Discord only sends subcommands we registered.
      return Result.ok(`Unknown subcommand "${subcommand}".`);
  }
}

export function privacyCommand(client: PrivacyClient) {
  return defineCommand({
    builder,
    execute: async (interaction) => {
      // Preferences are personal, so nothing here is posted publicly.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const outcome = await run(interaction, client);
      if (Result.isError(outcome)) return Result.err(outcome.error);

      await interaction.editReply(outcome.value);
      return Result.ok(undefined);
    },
  });
}
