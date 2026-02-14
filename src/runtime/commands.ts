import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import { Effect } from "effect";

import { AppConfig } from "../config";
import { commitOverflowCommand, handleCommitOverflowCommand } from "../features/commit-overflow";
import { doorOpenerCommand, handleDoorOpenerCommand } from "../features/door-opener";
import {
    initHnCommand,
    handleInitHnCommand,
    resetHnCommand,
    handleResetHnCommand,
} from "../features/hack-night";
import {
    startMeetingCommand,
    handleStartMeetingCommand,
    endMeetingCommand,
    handleEndMeetingCommand,
} from "../features/meeting-notes";
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
    {
        data: initHnCommand as unknown as SlashCommandBuilder,
        execute: handleInitHnCommand,
    },
    {
        data: resetHnCommand as unknown as SlashCommandBuilder,
        execute: handleResetHnCommand,
    },
    {
        data: startMeetingCommand as unknown as SlashCommandBuilder,
        execute: handleStartMeetingCommand,
    },
    {
        data: endMeetingCommand as unknown as SlashCommandBuilder,
        execute: handleEndMeetingCommand,
    },
];

export const getEnabledCommands = Effect.gen(function* () {
    const startTime = Date.now();
    const config = yield* AppConfig;

    const enabledCommands = commands.filter((cmd) => {
        if (cmd.data.name === "commit-overflow") {
            return config.COMMIT_OVERFLOW_ENABLED;
        }
        if (cmd.data.name === "start-meeting" || cmd.data.name === "end-meeting") {
            return config.MEETING_NOTES_ENABLED;
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
        meeting_notes_enabled: config.MEETING_NOTES_ENABLED,
    });

    yield* Effect.logInfo("commands filtered by enabled state", {
        total_commands_count: commands.length,
        enabled_commands_count: enabledCommands.length,
        disabled_commands_count: commands.length - enabledCommands.length,
        duration_ms: durationMs,
        command_names: commandNames.join(","),
        commit_overflow_enabled: config.COMMIT_OVERFLOW_ENABLED,
        meeting_notes_enabled: config.MEETING_NOTES_ENABLED,
    });

    return enabledCommands;
}).pipe(Effect.withSpan("Runtime.getEnabledCommands"));

export const findCommand = (name: string): Command | undefined => {
    return commands.find((c) => c.data.name === name);
};
