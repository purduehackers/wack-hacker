import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import { Effect } from "effect";

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
import { FeatureFlags } from "../services";

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
    const ff = yield* FeatureFlags;
    const flags = yield* ff.getFlags;

    const enabledCommands = commands.filter((cmd) => {
        if (cmd.data.name === "commit-overflow") {
            return flags.commitOverflow;
        }
        if (cmd.data.name === "start-meeting" || cmd.data.name === "end-meeting") {
            return flags.meetingNotes;
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
        commit_overflow_enabled: flags.commitOverflow,
        meeting_notes_enabled: flags.meetingNotes,
    });

    yield* Effect.logInfo("commands filtered by enabled state", {
        total_commands_count: commands.length,
        enabled_commands_count: enabledCommands.length,
        disabled_commands_count: commands.length - enabledCommands.length,
        duration_ms: durationMs,
        command_names: commandNames.join(","),
        commit_overflow_enabled: flags.commitOverflow,
        meeting_notes_enabled: flags.meetingNotes,
    });

    return enabledCommands;
}).pipe(Effect.withSpan("Runtime.getEnabledCommands"));

export const findCommand = (name: string): Command | undefined => {
    return commands.find((c) => c.data.name === name);
};
