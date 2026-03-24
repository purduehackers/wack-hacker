import {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    type ChatInputCommandInteraction,
} from "discord.js";
import { Effect } from "effect";

import { structuredError } from "../../errors";
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

        const reply = (content: string | EmbedBuilder) => {
            const options =
                content instanceof EmbedBuilder
                    ? { embeds: [content], flags: MessageFlags.Ephemeral as number }
                    : { content, flags: MessageFlags.Ephemeral as number };

            return Effect.tryPromise({
                try: async () => {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(options);
                    } else {
                        await interaction.reply(options);
                    }
                },
                catch: (cause) =>
                    new Error(
                        `Failed to send response: ${cause instanceof Error ? cause.message : String(cause)}`,
                    ),
            });
        };

        if (subcommand === "view") {
            const prefs = yield* pdb.getPreferences(userId).pipe(
                Effect.catchAll((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logError("privacy view failed", {
                            ...structuredError(error),
                            user_id: userId,
                        });
                        yield* reply("Failed to fetch your privacy preferences. Please try again later.");
                        return yield* Effect.fail(error);
                    }),
                ),
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

            yield* reply(embed);
        } else if (subcommand === "set") {
            const mode = interaction.options.getString("mode", true) as Mode;
            const reason = interaction.options.getString("reason") ?? undefined;

            if (mode === "opt_out_collection") {
                yield* reply(
                    "**Warning:** Setting your mode to **Opt Out (no data collected)** will permanently delete all your data across all Purdue Hackers projects. " +
                        "If you want to hide your data but keep it, use **Opt Out (hidden, data kept)** instead.\n\n" +
                        "Run this command again to confirm. Your mode has been updated.",
                ).pipe(Effect.ignore);
            }

            yield* pdb.setGlobalMode(userId, mode, reason).pipe(
                Effect.catchAll((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logError("privacy set failed", {
                            ...structuredError(error),
                            user_id: userId,
                            mode,
                        });
                        yield* reply("Failed to update your privacy preferences. Please try again later.");
                        return yield* Effect.fail(error);
                    }),
                ),
            );

            yield* reply(`Your global privacy mode has been set to **${MODE_LABELS[mode]}**.`);
        } else if (subcommand === "set-project") {
            const project = interaction.options.getString("project", true) as Project;
            const mode = interaction.options.getString("mode", true) as Mode;
            const reason = interaction.options.getString("reason") ?? undefined;

            yield* pdb.setProjectOverride(userId, project, mode, reason).pipe(
                Effect.catchAll((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logError("privacy set-project failed", {
                            ...structuredError(error),
                            user_id: userId,
                            project,
                            mode,
                        });
                        yield* reply("Failed to update your project override. Please try again later.");
                        return yield* Effect.fail(error);
                    }),
                ),
            );

            yield* reply(
                `Your privacy mode for **${PROJECT_LABELS[project]}** has been set to **${MODE_LABELS[mode]}**.`,
            );
        } else if (subcommand === "reset") {
            yield* pdb.resetPreferences(userId).pipe(
                Effect.catchAll((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logError("privacy reset failed", {
                            ...structuredError(error),
                            user_id: userId,
                        });
                        yield* reply("Failed to reset your privacy preferences. Please try again later.");
                        return yield* Effect.fail(error);
                    }),
                ),
            );

            yield* reply("Your privacy preferences have been reset to the default (Opt In).");
        } else if (subcommand === "reset-project") {
            const project = interaction.options.getString("project", true) as Project;

            yield* pdb.removeProjectOverride(userId, project).pipe(
                Effect.catchAll((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logError("privacy reset-project failed", {
                            ...structuredError(error),
                            user_id: userId,
                            project,
                        });
                        yield* reply(
                            "Failed to remove your project override. Please try again later.",
                        );
                        return yield* Effect.fail(error);
                    }),
                ),
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
