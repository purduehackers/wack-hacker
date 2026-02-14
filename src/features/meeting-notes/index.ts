import {
    ChannelType,
    MessageFlags,
    SlashCommandBuilder,
    ThreadAutoArchiveDuration,
    type ChatInputCommandInteraction,
    type NewsChannel,
    type TextChannel,
    type ThreadChannel,
    type VoiceState,
} from "discord.js";
import { Effect } from "effect";

import { AppConfig } from "../../config";
import { MEETING_TRANSCRIPT_THREAD_AUTO_ARCHIVE_DURATION } from "../../constants";
import { NotInVoiceChannel, structuredError } from "../../errors";
import { MeetingNotes } from "../../services/MeetingNotes";

export const startMeetingCommand = new SlashCommandBuilder()
    .setName("start-meeting")
    .setDescription("Start a meeting in your current voice channel.");

export const endMeetingCommand = new SlashCommandBuilder()
    .setName("end-meeting")
    .setDescription("End the active meeting and finalize notes.");

const getThreadParentChannel = (
    interaction: ChatInputCommandInteraction,
): TextChannel | NewsChannel | null => {
    const commandChannel = interaction.channel;

    if (!commandChannel) {
        return null;
    }

    if (
        commandChannel.type === ChannelType.GuildText ||
        commandChannel.type === ChannelType.GuildAnnouncement
    ) {
        return commandChannel;
    }

    if (!commandChannel.isThread()) {
        return null;
    }

    const parentChannel = commandChannel.parent;

    if (
        !parentChannel ||
        (parentChannel.type !== ChannelType.GuildText &&
            parentChannel.type !== ChannelType.GuildAnnouncement)
    ) {
        return null;
    }

    return parentChannel;
};

const buildThreadName = (voiceChannelName: string): string => {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const candidateName = `meeting-${voiceChannelName}-${timestamp}`;

    return candidateName.slice(0, 100);
};

const createTranscriptThread = Effect.fn("MeetingNotes.createTranscriptThread")(
    function* (interaction: ChatInputCommandInteraction, voiceChannelName: string) {
        const parentChannel = getThreadParentChannel(interaction);

        if (!parentChannel) {
            return yield* Effect.fail(
                new Error("Run this command in a text channel or thread with a text-channel parent."),
            );
        }

        return yield* Effect.tryPromise({
            try: () =>
                parentChannel.threads.create({
                    name: buildThreadName(voiceChannelName),
                    autoArchiveDuration:
                        MEETING_TRANSCRIPT_THREAD_AUTO_ARCHIVE_DURATION as ThreadAutoArchiveDuration,
                    reason: `Realtime transcript thread created by ${interaction.user.tag}.`,
                }),
            catch: (cause) =>
                new Error(
                    `Failed to create transcript thread: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });
    },
);

export const handleStartMeetingCommand = Effect.fn("MeetingNotes.handleStartMeetingCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const config = yield* AppConfig;

        if (!config.MEETING_NOTES_ENABLED) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "Meeting notes are currently disabled.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        if (!interaction.inCachedGuild()) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "This command can only be used in a server.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        const meetingNotes = yield* MeetingNotes;

        yield* Effect.tryPromise({
            try: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
            catch: (cause) =>
                new Error(
                    `Failed to defer command reply: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        let transcriptThread: ThreadChannel | null = null;

        const startProgram = Effect.gen(function* () {
            const member = yield* Effect.tryPromise({
                try: () => interaction.guild.members.fetch(interaction.user.id),
                catch: (cause) =>
                    new Error(
                        `Failed to fetch guild member: ${cause instanceof Error ? cause.message : String(cause)}`,
                    ),
            });

            const voiceChannel = member.voice.channel;

            if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                return yield* Effect.fail(
                    new NotInVoiceChannel({
                        guildId: interaction.guildId,
                        userId: interaction.user.id,
                    }),
                );
            }

            transcriptThread = yield* createTranscriptThread(interaction, voiceChannel.name);

            const startResult = yield* meetingNotes.startMeeting({
                channel: voiceChannel,
                transcriptThread,
                startedByUserId: interaction.user.id,
                startedByTag: interaction.user.tag,
            });

            yield* Effect.tryPromise({
                try: () =>
                    interaction.editReply({
                        content:
                            `Meeting started in <#${startResult.channelId}>.\n` +
                            `Live transcript thread: <#${startResult.transcriptThreadId}>.`,
                    }),
                catch: () => undefined,
            });
        });

        yield* startProgram.pipe(
            Effect.catchAll((cause) =>
                Effect.gen(function* () {
                    if (transcriptThread) {
                        yield* Effect.tryPromise({
                            try: () =>
                                transcriptThread!.setArchived(
                                    true,
                                    "Archived because meeting start failed.",
                                ),
                            catch: () => undefined,
                        }).pipe(Effect.ignore);
                    }

                    const taggedCause =
                        typeof cause === "object" && cause !== null && "_tag" in cause
                            ? (cause as { _tag: string; activeChannelId?: string })
                            : null;

                    if (taggedCause?._tag === "NotInVoiceChannel") {
                        yield* Effect.tryPromise({
                            try: () =>
                                interaction.editReply({
                                    content:
                                        "Join a voice channel first, then run `/start-meeting` again.",
                                }),
                            catch: () => undefined,
                        });
                        return;
                    }

                    if (
                        taggedCause?._tag === "MeetingAlreadyActive" &&
                        taggedCause.activeChannelId
                    ) {
                        yield* Effect.tryPromise({
                            try: () =>
                                interaction.editReply({
                                    content: `A meeting is already active in <#${taggedCause.activeChannelId}>.`,
                                }),
                            catch: () => undefined,
                        });
                        return;
                    }

                    if (taggedCause?._tag === "MeetingVoiceJoinFailed") {
                        yield* Effect.tryPromise({
                            try: () =>
                                interaction.editReply({
                                    content:
                                        "Failed to join your voice channel. Check bot permissions and try again.",
                                }),
                            catch: () => undefined,
                        });
                        return;
                    }

                    yield* Effect.logError("start meeting command failed", {
                        ...structuredError(cause),
                        guild_id: interaction.guildId,
                        user_id: interaction.user.id,
                        channel_id: interaction.channelId,
                    });

                    yield* Effect.tryPromise({
                        try: () =>
                            interaction.editReply({
                                content: "Failed to start meeting. Please try again.",
                            }),
                        catch: () => undefined,
                    });
                }),
            ),
        );
    },
);

export const handleEndMeetingCommand = Effect.fn("MeetingNotes.handleEndMeetingCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const config = yield* AppConfig;

        if (!config.MEETING_NOTES_ENABLED) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "Meeting notes are currently disabled.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        if (!interaction.inCachedGuild()) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "This command can only be used in a server.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        const meetingNotes = yield* MeetingNotes;

        yield* Effect.tryPromise({
            try: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
            catch: (cause) =>
                new Error(
                    `Failed to defer command reply: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        yield* meetingNotes
            .endMeeting({
                guildId: interaction.guildId,
                reason: "manual",
            })
            .pipe(
                Effect.flatMap((result) =>
                    Effect.tryPromise({
                        try: () =>
                            interaction.editReply({
                                content: result.alreadyEnding
                                    ? "Meeting finalization is already in progress."
                                    : result.notionPageUrl
                                      ? `Meeting ended for <#${result.channelId}>. Notes: ${result.notionPageUrl}`
                                      : `Meeting ended for <#${result.channelId}>. Finalization completed without a Notion link.`,
                            }),
                        catch: () => undefined,
                    }).pipe(Effect.asVoid),
                ),
                Effect.catchAll((cause) =>
                    Effect.gen(function* () {
                        const taggedCause =
                            typeof cause === "object" && cause !== null && "_tag" in cause
                                ? (cause as { _tag: string })
                                : null;

                        if (taggedCause?._tag === "NoActiveMeeting") {
                            yield* Effect.tryPromise({
                                try: () =>
                                    interaction.editReply({
                                        content: "No active meeting is running in this server.",
                                    }),
                                catch: () => undefined,
                            });
                            return;
                        }

                        yield* Effect.logError("end meeting command failed", {
                            ...structuredError(cause),
                            guild_id: interaction.guildId,
                            user_id: interaction.user.id,
                            channel_id: interaction.channelId,
                        });

                        yield* Effect.tryPromise({
                            try: () =>
                                interaction.editReply({
                                    content: "Failed to end meeting. Please try again.",
                                }),
                            catch: () => undefined,
                        });
                    }),
                ),
            );
    },
);

export const handleMeetingVoiceStateUpdate = Effect.fn("MeetingNotes.handleVoiceStateUpdate")(
    function* (oldState: VoiceState, newState: VoiceState) {
        const config = yield* AppConfig;

        if (!config.MEETING_NOTES_ENABLED) {
            return;
        }

        const meetingNotes = yield* MeetingNotes;

        yield* meetingNotes.handleVoiceStateUpdate(oldState, newState).pipe(
            Effect.catchAll((cause) =>
                Effect.logWarning("meeting voice state update failed", {
                    guild_id: newState.guild.id,
                    old_channel_id: oldState.channelId ?? "none",
                    new_channel_id: newState.channelId ?? "none",
                    error_message: safeErrorMessage(cause),
                }),
            ),
        );
    },
);

const safeErrorMessage = (cause: unknown): string => {
    if (cause instanceof Error) {
        return cause.message;
    }

    return String(cause);
};

export const isMeetingCommandName = (name: string): boolean => {
    return name === startMeetingCommand.name || name === endMeetingCommand.name;
};
