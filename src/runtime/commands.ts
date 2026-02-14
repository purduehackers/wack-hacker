import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import { Effect } from "effect";

import { AppConfig } from "../config";
import { commitOverflowCommand, handleCommitOverflowCommand } from "../features/commit-overflow";
import { doorOpenerCommand, handleDoorOpenerCommand } from "../features/door-opener";
import { summarizeCommand, handleSummarizeCommand } from "../features/summarize";

interface Command {
    data: SlashCommandBuilder;
    execute: (interaction: ChatInputCommandInteraction) => Effect.Effect<void, unknown, unknown>;
    enabled?: boolean;
}

export const commands: Command[] = [
    {
        data: summarizeCommand as unknown as SlashCommandBuilder,
        execute: handleSummarizeCommand,
    },
    {
        data: commitOverflowCommand as unknown as SlashCommandBuilder,
        execute: handleCommitOverflowCommand,
    },
    {
        data: doorOpenerCommand as unknown as SlashCommandBuilder,
        execute: handleDoorOpenerCommand,
    },
];

export const getEnabledCommands = Effect.gen(function* () {
    const startTime = Date.now();
    const config = yield* AppConfig;

    const enabledCommands = commands.filter((cmd) => {
        if (cmd.data.name === "commit-overflow") {
            return config.COMMIT_OVERFLOW_ENABLED;
        }
        return true;
    });

    const durationMs = Date.now() - startTime;
    const commandNames = enabledCommands.map((cmd) => cmd.data.name);

    yield* Effect.annotateCurrentSpan({
        total_commands_count: commands.length,
        enabled_commands_count: enabledCommands.length,
        disabled_commands_count: commands.length - enabledCommands.length,
        duration_ms: durationMs,
        command_names: commandNames.join(","),
        commit_overflow_enabled: config.COMMIT_OVERFLOW_ENABLED,
    });

    yield* Effect.logInfo("commands filtered by enabled state", {
        total_commands_count: commands.length,
        enabled_commands_count: enabledCommands.length,
        disabled_commands_count: commands.length - enabledCommands.length,
        duration_ms: durationMs,
        command_names: commandNames.join(","),
        commit_overflow_enabled: config.COMMIT_OVERFLOW_ENABLED,
    });

    return enabledCommands;
}).pipe(Effect.withSpan("Runtime.getEnabledCommands"));

export const findCommand = (name: string): Command | undefined => {
    return commands.find((c) => c.data.name === name);
};
