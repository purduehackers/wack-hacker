import {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    type ChatInputCommandInteraction,
} from "discord.js";
import { Effect } from "effect";

import { DiscordError, structuredError } from "../../errors";
import { safeReply } from "../../lib/discord";
import { PrivacyDB, type Mode, type Project } from "../../services/PrivacyDB";

const MODE_LABELS: Record<Mode, string> = {
    opt_in: "Opt In (public)",
    opt_out_privacy: "Opt Out (hidden, data kept)",
    opt_out_collection: "Opt Out (no data collected)",
};

const PROJECT_LABELS: Record<Project, string> = {
    "commit-overflow": "Commit Overflow",
    ships: "Ships",
};

export const privacyCommand = new SlashCommandBuilder()
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
                    .addChoices(
                        { name: "Opt In (public)", value: "opt_in" },
                        { name: "Opt Out (hidden, data kept)", value: "opt_out_privacy" },
                        { name: "Opt Out (no data collected)", value: "opt_out_collection" },
                    ),
            )
            .addStringOption((opt) =>
                opt.setName("reason").setDescription("Optional reason for your choice"),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName("set-project")
            .setDescription("Override your privacy mode for a specific project")
            .addStringOption((opt) =>
                opt
                    .setName("project")
                    .setDescription("The project to override")
                    .setRequired(true)
                    .addChoices(
                        { name: "Commit Overflow", value: "commit-overflow" },
                        { name: "Ships", value: "ships" },
                    ),
            )
            .addStringOption((opt) =>
                opt
                    .setName("mode")
                    .setDescription("Your privacy mode for this project")
                    .setRequired(true)
                    .addChoices(
                        { name: "Opt In (public)", value: "opt_in" },
                        { name: "Opt Out (hidden, data kept)", value: "opt_out_privacy" },
                        { name: "Opt Out (no data collected)", value: "opt_out_collection" },
                    ),
            )
            .addStringOption((opt) =>
                opt.setName("reason").setDescription("Optional reason for your choice"),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName("reset")
            .setDescription("Reset all privacy preferences back to default (opt in)"),
    )
    .addSubcommand((sub) =>
        sub
            .setName("reset-project")
            .setDescription("Remove a project-specific override (falls back to global mode)")
            .addStringOption((opt) =>
                opt
                    .setName("project")
                    .setDescription("The project to reset")
                    .setRequired(true)
                    .addChoices(
                        { name: "Commit Overflow", value: "commit-overflow" },
                        { name: "Ships", value: "ships" },
                    ),
            ),
    );

export const handlePrivacyCommand = Effect.fn("Privacy.handleCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const startTime = Date.now();
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        yield* Effect.annotateCurrentSpan({
            user_id: userId,
            channel_id: interaction.channelId,
            guild_id: interaction.guildId ?? "dm",
            subcommand,
        });

        yield* Effect.logInfo("privacy command invoked", {
            user_id: userId,
            username: interaction.user.username,
            channel_id: interaction.channelId,
            guild_id: interaction.guildId ?? "dm",
            subcommand,
        });

        const pdb = yield* PrivacyDB;

        const reply = (content: string) =>
            safeReply(interaction, content, true);

        const replyEmbed = (embed: EmbedBuilder) =>
            Effect.tryPromise({
                try: () =>
                    interaction.replied || interaction.deferred
                        ? interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral as number })
                        : interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral as number }),
                catch: (cause) =>
                    new DiscordError({
                        action: "privacy.replyEmbed",
                        cause,
                    }),
            });

        const withErrorReply = <A, E>(
            effect: Effect.Effect<A, E>,
            label: string,
            userMessage: string,
            context?: Record<string, unknown>,
        ) =>
            effect.pipe(
                Effect.tapError((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logError(`privacy ${label} failed`, {
                            ...structuredError(error),
                            user_id: userId,
                            ...context,
                        });
                        yield* reply(userMessage).pipe(Effect.ignore);
                    }),
                ),
            );

        if (subcommand === "view") {
            const prefs = yield* withErrorReply(
                pdb.getPreferences(userId),
                "view",
                "Failed to fetch your privacy preferences. Please try again later.",
            );

            const overrideLines = Object.entries(prefs.overrides).map(
                ([project, mode]) =>
                    `**${PROJECT_LABELS[project as Project] ?? project}**: ${MODE_LABELS[mode as Mode] ?? mode}`,
            );

            const embed = new EmbedBuilder()
                .setTitle("Your Privacy Preferences")
                .setColor(0x5865f2)
                .addFields(
                    { name: "Global Mode", value: MODE_LABELS[prefs.mode] ?? prefs.mode },
                    {
                        name: "Project Overrides",
                        value: overrideLines.length > 0 ? overrideLines.join("\n") : "None",
                    },
                );

            yield* replyEmbed(embed);
        } else if (subcommand === "set") {
            const mode = interaction.options.getString("mode", true) as Mode;
            const reason = interaction.options.getString("reason") ?? undefined;

            yield* withErrorReply(
                pdb.setGlobalMode(userId, mode, reason),
                "set",
                "Failed to update your privacy preferences. Please try again later.",
                { mode },
            );

            if (mode === "opt_out_collection") {
                yield* reply(
                    `Your global privacy mode has been set to **${MODE_LABELS[mode]}**.\n\n` +
                        "**Warning:** This will permanently delete all your data across all Purdue Hackers projects. " +
                        "If you want to hide your data but keep it, use `/privacy set` with **Opt Out (hidden, data kept)** instead.",
                );
            } else {
                yield* reply(`Your global privacy mode has been set to **${MODE_LABELS[mode]}**.`);
            }
        } else if (subcommand === "set-project") {
            const project = interaction.options.getString("project", true) as Project;
            const mode = interaction.options.getString("mode", true) as Mode;
            const reason = interaction.options.getString("reason") ?? undefined;

            yield* withErrorReply(
                pdb.setProjectOverride(userId, project, mode, reason),
                "set-project",
                "Failed to update your project override. Please try again later.",
                { project, mode },
            );

            yield* reply(
                `Your privacy mode for **${PROJECT_LABELS[project]}** has been set to **${MODE_LABELS[mode]}**.`,
            );
        } else if (subcommand === "reset") {
            yield* withErrorReply(
                pdb.resetPreferences(userId),
                "reset",
                "Failed to reset your privacy preferences. Please try again later.",
            );

            yield* reply("Your privacy preferences have been reset to the default (Opt In).");
        } else if (subcommand === "reset-project") {
            const project = interaction.options.getString("project", true) as Project;

            yield* withErrorReply(
                pdb.removeProjectOverride(userId, project),
                "reset-project",
                "Failed to remove your project override. Please try again later.",
                { project },
            );

            yield* reply(
                `Your override for **${PROJECT_LABELS[project]}** has been removed. It will now follow your global mode.`,
            );
        }

        yield* Effect.logInfo("privacy command completed", {
            user_id: userId,
            username: interaction.user.username,
            subcommand,
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "privacy" }),
);
