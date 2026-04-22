import { SlashCommandBuilder } from "discord.js";
import { log } from "evlog";

import type { SlashCommandContext } from "@/bot/commands/types";

import { defineCommand } from "@/bot/commands/define";
import { respond } from "@/bot/commands/helpers";
import { parseSubcommand } from "@/bot/commands/registry";
import { PrivacyClient, PrivacyMode, PrivacyProject } from "@/bot/integrations/privacy";
import { env } from "@/env";

const PRIVACY_DB_URL = "https://pdb.purduehackers.com";

const MODE_CHOICES = [
  { name: "Opt In (public)", value: "opt_in" },
  { name: "Opt Out (hidden, data kept)", value: "opt_out_privacy" },
  { name: "Opt Out (no data collected)", value: "opt_out_collection" },
] as const;

const PROJECT_CHOICES = [
  { name: "Commit Overflow", value: "commit-overflow" },
  { name: "Ships", value: "ships" },
] as const;

const MODE_LABELS: Record<PrivacyMode, string> = {
  [PrivacyMode.OptIn]: "Opt In (public)",
  [PrivacyMode.OptOutPrivacy]: "Opt Out (hidden, data kept)",
  [PrivacyMode.OptOutCollection]: "Opt Out (no data collected)",
};

const PROJECT_LABELS: Record<PrivacyProject, string> = {
  [PrivacyProject.CommitOverflow]: "Commit Overflow",
  [PrivacyProject.Ships]: "Ships",
};

async function handleView(ctx: SlashCommandContext, client: PrivacyClient, userId: string) {
  const prefs = await client.getPreferences(userId);
  const overrides =
    Object.entries(prefs.overrides)
      .map(
        ([p, m]) =>
          `**${PROJECT_LABELS[p as PrivacyProject] ?? p}**: ${MODE_LABELS[m as PrivacyMode] ?? m}`,
      )
      .join("\n") || "None";

  await respond(
    ctx,
    `**Your Privacy Preferences**\n\n` +
      `**Global Mode:** ${MODE_LABELS[prefs.mode as PrivacyMode] ?? prefs.mode}\n` +
      `**Project Overrides:**\n${overrides}`,
  );
}

async function handleSet(ctx: SlashCommandContext, client: PrivacyClient, userId: string) {
  const mode = ctx.options.get("mode") as PrivacyMode;
  const reason = ctx.options.get("reason") as string | undefined;
  await client.setGlobalMode(userId, mode, reason);

  if (mode === PrivacyMode.OptOutCollection) {
    await respond(
      ctx,
      `Your global privacy mode has been set to **${MODE_LABELS[mode]}**.\n\n` +
        "**Warning:** This will permanently delete all your data across all Purdue Hackers projects. " +
        "If you want to hide your data but keep it, use `/privacy set` with **Opt Out (hidden, data kept)** instead.",
    );
  } else {
    await respond(ctx, `Your global privacy mode has been set to **${MODE_LABELS[mode]}**.`);
  }
}

async function handleSetProject(ctx: SlashCommandContext, client: PrivacyClient, userId: string) {
  const project = ctx.options.get("project") as PrivacyProject;
  const mode = ctx.options.get("mode") as PrivacyMode;
  const reason = ctx.options.get("reason") as string | undefined;
  await client.setProjectOverride(userId, project, mode, reason);
  await respond(
    ctx,
    `Your privacy mode for **${PROJECT_LABELS[project]}** has been set to **${MODE_LABELS[mode]}**.`,
  );
}

async function handleReset(ctx: SlashCommandContext, client: PrivacyClient, userId: string) {
  await client.resetPreferences(userId);
  await respond(ctx, "Your privacy preferences have been reset to the default (Opt In).");
}

async function handleResetProject(ctx: SlashCommandContext, client: PrivacyClient, userId: string) {
  const project = ctx.options.get("project") as PrivacyProject;
  await client.removeProjectOverride(userId, project);
  await respond(
    ctx,
    `Your override for **${PROJECT_LABELS[project]}** has been removed. It will now follow your global mode.`,
  );
}

export const privacy = defineCommand({
  builder: new SlashCommandBuilder()
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
    ),
  async execute(ctx) {
    const client = new PrivacyClient(PRIVACY_DB_URL, env.PRIVACY_DB_API_KEY);
    const sub = parseSubcommand(ctx.interaction.data?.options);
    const userId = ctx.interaction.member?.user.id ?? ctx.interaction.user?.id ?? "";

    try {
      switch (sub) {
        case "view":
          await handleView(ctx, client, userId);
          break;
        case "set":
          await handleSet(ctx, client, userId);
          break;
        case "set-project":
          await handleSetProject(ctx, client, userId);
          break;
        case "reset":
          await handleReset(ctx, client, userId);
          break;
        case "reset-project":
          await handleResetProject(ctx, client, userId);
          break;
        default:
          await respond(ctx, "Unknown subcommand.");
      }
    } catch (err) {
      log.warn("privacy", `Command failed: ${String(err)}`);
      await respond(ctx, "Something went wrong. Please try again later.");
    }
  },
});
