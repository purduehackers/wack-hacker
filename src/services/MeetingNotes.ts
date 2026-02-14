import { entersState, joinVoiceChannel, VoiceConnectionStatus, type VoiceConnection } from "@discordjs/voice";
import type { Guild, Snowflake, ThreadChannel, VoiceBasedChannel, VoiceState } from "discord.js";
import { Chunk, Duration, Effect, Fiber, PubSub, Ref, Stream, SynchronizedRef } from "effect";

import { AppConfig } from "../config";
import {
    MEETING_LIVE_TRANSCRIPT_PREFIX,
    MEETING_LIVE_UPDATE_INTERVAL_MS,
    MEETING_MAX_DISCORD_MESSAGE_LENGTH,
    MEETING_NOTES_DEFAULT_DIRECTORY,
} from "../constants";
import {
    FeatureDisabled,
    MeetingAlreadyActive,
    MeetingTranscriptionError,
    MeetingVoiceJoinFailed,
    NoActiveMeeting,
} from "../errors";

import { AI } from "./AI";
import { Notion } from "./Notion";
import {
    createDiarizedTranscript,
    type DiarizedTranscript,
    type SpeakerTranscriptSegment,
} from "./MeetingNotesDiarizedTranscript";
import { MeetingSpeechTranscriber, type TranscriptUpdate } from "./MeetingNotesTranscriber";

const MAX_LIVE_TRANSCRIPT_LENGTH =
    MEETING_MAX_DISCORD_MESSAGE_LENGTH - MEETING_LIVE_TRANSCRIPT_PREFIX.length;

const FINAL_TRANSCRIPT_HEADER = "**Finalized Transcript**";
const FINAL_NOTES_HEADER = "**Final Meeting Notes**";
const NO_TRANSCRIPT_AVAILABLE = "No final transcript was available for this meeting.";

const NOTE_SYSTEM_PROMPT = `You are a meeting notes assistant.
Given a meeting transcript, produce concise notes with these sections:
1. Summary
2. Decisions
3. Action Items
4. Open Questions

Each section must be present. Keep action items explicit and attributable when possible.`;

interface MeetingSession {
    readonly guildId: Snowflake;
    readonly channelId: Snowflake;
    readonly transcriptThreadId: Snowflake;
    readonly transcriptThread: ThreadChannel;
    readonly connection: VoiceConnection;
    readonly transcriber: MeetingSpeechTranscriber;
    readonly transcriptPubSub: PubSub.PubSub<TranscriptUpdate>;
    readonly hadHumanParticipantRef: Ref.Ref<boolean>;
    readonly endingRef: Ref.Ref<boolean>;
    readonly draftMessageIdRef: Ref.Ref<Snowflake | null>;
    readonly draftTextRef: Ref.Ref<string>;
    readonly committedTranscriptRef: Ref.Ref<ReadonlyArray<string>>;
    readonly liveConsumerFiber: Fiber.RuntimeFiber<void, never>;
    readonly committedConsumerFiber: Fiber.RuntimeFiber<void, never>;
    readonly startedAt: Date;
    readonly startedByUserId: string;
    readonly startedByTag: string;
}

interface StartMeetingInput {
    readonly channel: VoiceBasedChannel;
    readonly transcriptThread: ThreadChannel;
    readonly startedByUserId: string;
    readonly startedByTag: string;
}

interface EndMeetingInput {
    readonly guildId: Snowflake;
    readonly reason: "manual" | "auto_empty";
}

interface EndMeetingResult {
    readonly channelId: Snowflake;
    readonly transcriptThreadId: Snowflake;
    readonly notionPageUrl: string | null;
    readonly alreadyEnding: boolean;
    readonly reason: "manual" | "auto_empty";
}

const formatSpeakerTranscript = (segments: ReadonlyArray<SpeakerTranscriptSegment>): string => {
    if (segments.length === 0) {
        return "";
    }

    return segments.map((segment) => `[${segment.speakerId}] ${segment.text}`).join("\n");
};

const chunkTranscript = (transcript: string): string[] => {
    if (transcript.length <= MEETING_MAX_DISCORD_MESSAGE_LENGTH) {
        return [transcript];
    }

    const chunks: string[] = [];
    let offset = 0;

    while (offset < transcript.length) {
        chunks.push(transcript.slice(offset, offset + MEETING_MAX_DISCORD_MESSAGE_LENGTH));
        offset += MEETING_MAX_DISCORD_MESSAGE_LENGTH;
    }

    return chunks;
};

const safeString = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }

    return String(value);
};

export class MeetingNotes extends Effect.Service<MeetingNotes>()("MeetingNotes", {
    dependencies: [AppConfig.Default, AI.Default, Notion.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const ai = yield* AI;
        const notion = yield* Notion;

        const sessionsRef = yield* SynchronizedRef.make(new Map<Snowflake, MeetingSession>());

        const appendTranscriptToThread = Effect.fn("MeetingNotes.appendTranscriptToThread")(
            function* (thread: ThreadChannel, transcriptText: string) {
                const trimmedTranscript = transcriptText.trim();

                if (!trimmedTranscript) {
                    return;
                }

                const chunks = chunkTranscript(trimmedTranscript);

                yield* Effect.forEach(
                    chunks,
                    (chunk) =>
                        Effect.tryPromise({
                            try: () => thread.send(chunk),
                            catch: (cause) =>
                                new MeetingTranscriptionError({
                                    operation: "appendTranscriptToThread",
                                    cause,
                                }),
                        }),
                    { concurrency: 1, discard: true },
                );
            },
        );

        const clearLiveDraftMessage = Effect.fn("MeetingNotes.clearLiveDraftMessage")(
            function* (session: MeetingSession) {
                const draftMessageId = yield* Ref.get(session.draftMessageIdRef);

                if (!draftMessageId) {
                    yield* Ref.set(session.draftTextRef, "");
                    return;
                }

                yield* Effect.tryPromise({
                    try: () => session.transcriptThread.messages.delete(draftMessageId),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* Ref.set(session.draftMessageIdRef, null);
                yield* Ref.set(session.draftTextRef, "");
            },
        );

        const upsertLiveDraftMessage = Effect.fn("MeetingNotes.upsertLiveDraftMessage")(
            function* (session: MeetingSession, transcript: string) {
                const liveText = transcript.slice(0, MAX_LIVE_TRANSCRIPT_LENGTH);
                const previousText = yield* Ref.get(session.draftTextRef);

                if (liveText === previousText) {
                    return;
                }

                const draftMessageId = yield* Ref.get(session.draftMessageIdRef);
                const message = `${MEETING_LIVE_TRANSCRIPT_PREFIX}${liveText}`;

                if (!draftMessageId) {
                    const sentMessage = yield* Effect.tryPromise({
                        try: () => session.transcriptThread.send(message),
                        catch: (cause) =>
                            new MeetingTranscriptionError({
                                operation: "upsertLiveDraftMessage.create",
                                cause,
                            }),
                    });

                    yield* Ref.set(session.draftMessageIdRef, sentMessage.id);
                    yield* Ref.set(session.draftTextRef, liveText);
                    return;
                }

                const editResult = yield* Effect.tryPromise({
                    try: () => session.transcriptThread.messages.edit(draftMessageId, message),
                    catch: () => null,
                });

                if (editResult === null) {
                    yield* Ref.set(session.draftMessageIdRef, null);
                    yield* Ref.set(session.draftTextRef, "");
                    return;
                }

                yield* Ref.set(session.draftTextRef, liveText);
            },
        );

        const startLiveConsumer = Effect.fn("MeetingNotes.startLiveConsumer")(function* (
            session: Omit<
                MeetingSession,
                "liveConsumerFiber" | "committedConsumerFiber" | "transcriber" | "connection"
            > & {
                readonly connection: VoiceConnection;
            },
        ) {
            const consumer = Effect.scoped(
                Effect.gen(function* () {
                    const queue = yield* PubSub.subscribe(session.transcriptPubSub);

                    const liveStream = Stream.fromQueue(queue).pipe(
                        Stream.filter((update) => !update.isCommitted),
                        Stream.map((update) => update.text.trim()),
                        Stream.filter((text) => text.length > 0),
                        Stream.debounce(`${MEETING_LIVE_UPDATE_INTERVAL_MS} millis`),
                    );

                    yield* Stream.runForEach(liveStream, (liveText) =>
                        upsertLiveDraftMessage(session as MeetingSession, liveText).pipe(
                            Effect.catchAll((cause) =>
                                Effect.logWarning("meeting live draft upsert failed", {
                                    guild_id: session.guildId,
                                    transcript_thread_id: session.transcriptThreadId,
                                    error_message: safeString(cause),
                                }),
                            ),
                        ),
                    );
                }),
            );

            return yield* Effect.forkDaemon(consumer);
        });

        const startCommittedConsumer = Effect.fn("MeetingNotes.startCommittedConsumer")(
            function* (
                session: Omit<
                    MeetingSession,
                    "liveConsumerFiber" | "committedConsumerFiber" | "transcriber" | "connection"
                > & {
                    readonly connection: VoiceConnection;
                },
            ) {
                const consumer = Effect.scoped(
                    Effect.gen(function* () {
                        const queue = yield* PubSub.subscribe(session.transcriptPubSub);

                        const committedStream = Stream.fromQueue(queue).pipe(
                            Stream.filter((update) => update.isCommitted),
                            Stream.map((update) => update.text.trim()),
                            Stream.filter((text) => text.length > 0),
                            Stream.groupedWithin(6, "1 second"),
                        );

                        yield* Stream.runForEach(committedStream, (chunk) =>
                            Effect.gen(function* () {
                                const committedSegments = Chunk.toReadonlyArray(chunk);

                                if (committedSegments.length === 0) {
                                    return;
                                }

                                yield* clearLiveDraftMessage(session as MeetingSession).pipe(
                                    Effect.catchAll(() => Effect.void),
                                );

                                for (const segment of committedSegments) {
                                    yield* Ref.update(session.committedTranscriptRef, (segments) => [
                                        ...segments,
                                        segment,
                                    ]);
                                    yield* appendTranscriptToThread(
                                        session.transcriptThread,
                                        segment,
                                    ).pipe(
                                        Effect.catchAll((cause) =>
                                            Effect.logWarning("meeting committed transcript send failed", {
                                                guild_id: session.guildId,
                                                transcript_thread_id: session.transcriptThreadId,
                                                error_message: safeString(cause),
                                            }),
                                        ),
                                    );
                                }
                            }),
                        );
                    }),
                );

                return yield* Effect.forkDaemon(consumer);
            },
        );

        const removeSessionFromMap = Effect.fn("MeetingNotes.removeSessionFromMap")(
            function* (guildId: Snowflake) {
                yield* SynchronizedRef.update(sessionsRef, (sessions) => {
                    const nextSessions = new Map(sessions);
                    nextSessions.delete(guildId);
                    return nextSessions;
                });
            },
        );

        const cleanupSessionResources = Effect.fn("MeetingNotes.cleanupSessionResources")(
            function* (session: MeetingSession) {
                yield* Fiber.interrupt(session.liveConsumerFiber).pipe(Effect.ignore);
                yield* Fiber.interrupt(session.committedConsumerFiber).pipe(Effect.ignore);
                yield* PubSub.shutdown(session.transcriptPubSub).pipe(Effect.ignore);
                yield* clearLiveDraftMessage(session).pipe(Effect.ignore);
            },
        );

        const buildFinalTranscript = Effect.fn("MeetingNotes.buildFinalTranscript")(
            function* (session: MeetingSession, recordingPath: string | null) {
                const committedSegments = yield* Ref.get(session.committedTranscriptRef);
                const committedFallback = committedSegments.join("\n");

                if (!recordingPath) {
                    return {
                        transcript: committedFallback,
                        diarized: null as DiarizedTranscript | null,
                    };
                }

                const diarizedResult = yield* Effect.tryPromise({
                    try: () =>
                        createDiarizedTranscript(
                            config.ELEVENLABS_API_KEY,
                            recordingPath,
                        ),
                    catch: (cause) =>
                        new MeetingTranscriptionError({
                            operation: "buildFinalTranscript.diarized",
                            cause,
                        }),
                }).pipe(
                    Effect.either,
                );

                if (diarizedResult._tag === "Left") {
                    yield* Effect.logWarning("meeting diarized transcript failed using committed fallback", {
                        guild_id: session.guildId,
                        channel_id: session.channelId,
                        transcript_thread_id: session.transcriptThreadId,
                        error_message: safeString(diarizedResult.left),
                    });

                    return {
                        transcript: committedFallback,
                        diarized: null as DiarizedTranscript | null,
                    };
                }

                const diarized = diarizedResult.right;
                const formattedTranscript = formatSpeakerTranscript(diarized.segments);

                if (formattedTranscript.trim().length > 0) {
                    return {
                        transcript: formattedTranscript,
                        diarized,
                    };
                }

                if (diarized.text.trim().length > 0) {
                    return {
                        transcript: diarized.text,
                        diarized,
                    };
                }

                return {
                    transcript: committedFallback,
                    diarized,
                };
            },
        );

        const summarizeMeetingNotes = Effect.fn("MeetingNotes.summarizeMeetingNotes")(
            function* (session: MeetingSession, transcript: string) {
                const userPrompt = [
                    `Meeting directory: ${MEETING_NOTES_DEFAULT_DIRECTORY}`,
                    `Guild ID: ${session.guildId}`,
                    `Voice Channel ID: ${session.channelId}`,
                    `Transcript Thread ID: ${session.transcriptThreadId}`,
                    "",
                    "Transcript:",
                    transcript.trim().length > 0 ? transcript : NO_TRANSCRIPT_AVAILABLE,
                ].join("\n");

                return yield* ai.chat({
                    systemPrompt: NOTE_SYSTEM_PROMPT,
                    userPrompt,
                });
            },
        );

        const finalizeSession = Effect.fn("MeetingNotes.finalizeSession")(
            function* (session: MeetingSession, reason: "manual" | "auto_empty") {
                const endStartedAt = Date.now();

                let recordingPath: string | null = null;

                const stopResult = yield* Effect.tryPromise({
                    try: () => session.transcriber.stop(),
                    catch: (cause) =>
                        new MeetingTranscriptionError({
                            operation: "finalizeSession.stopTranscriber",
                            cause,
                        }),
                }).pipe(Effect.either);

                if (stopResult._tag === "Right") {
                    recordingPath = stopResult.right;
                } else {
                    yield* Effect.logWarning("meeting transcriber stop failed", {
                        guild_id: session.guildId,
                        channel_id: session.channelId,
                        transcript_thread_id: session.transcriptThreadId,
                        error_message: safeString(stopResult.left),
                    });
                }

                yield* Effect.sync(() => session.connection.destroy()).pipe(Effect.ignore);
                yield* cleanupSessionResources(session);

                const { transcript } = yield* buildFinalTranscript(session, recordingPath);
                const notes = yield* summarizeMeetingNotes(session, transcript).pipe(
                    Effect.catchAll((cause) =>
                        Effect.succeed(
                            `Summary generation failed.\n\nError: ${safeString(cause)}\n\nTranscript fallback:\n${transcript || NO_TRANSCRIPT_AVAILABLE}`,
                        ),
                    ),
                );

                const title = `Meeting ${session.transcriptThread.name} ${session.startedAt.toISOString().slice(0, 16)}`;

                const notionEntry = yield* notion
                    .createMeetingEntry({
                        title,
                        guildId: session.guildId,
                        voiceChannelId: session.channelId,
                        transcriptThreadId: session.transcriptThreadId,
                        startedAt: session.startedAt,
                        endedAt: new Date(),
                        endedReason: reason,
                    })
                    .pipe(
                        Effect.catchAll((cause) =>
                            Effect.gen(function* () {
                                yield* Effect.logError("meeting notion entry creation failed", {
                                    guild_id: session.guildId,
                                    channel_id: session.channelId,
                                    transcript_thread_id: session.transcriptThreadId,
                                    error_message: safeString(cause),
                                });

                                return {
                                    pageId: "",
                                    pageUrl: "",
                                };
                            }),
                        ),
                    );

                if (notionEntry.pageId) {
                    yield* notion
                        .appendSections(notionEntry.pageId, [
                            {
                                heading: "Final Meeting Notes",
                                content: notes,
                            },
                            {
                                heading: "Final Transcript",
                                content: transcript.trim().length > 0 ? transcript : NO_TRANSCRIPT_AVAILABLE,
                            },
                        ])
                        .pipe(
                            Effect.catchAll((cause) =>
                                Effect.logError("meeting notion sections append failed", {
                                    guild_id: session.guildId,
                                    channel_id: session.channelId,
                                    transcript_thread_id: session.transcriptThreadId,
                                    notion_page_id: notionEntry.pageId,
                                    error_message: safeString(cause),
                                }),
                            ),
                        );
                }

                yield* Effect.tryPromise({
                    try: () => session.transcriptThread.send(FINAL_NOTES_HEADER),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* appendTranscriptToThread(session.transcriptThread, notes).pipe(
                    Effect.catchAll((cause) =>
                        Effect.logWarning("meeting final notes thread send failed", {
                            guild_id: session.guildId,
                            transcript_thread_id: session.transcriptThreadId,
                            error_message: safeString(cause),
                        }),
                    ),
                );

                yield* Effect.tryPromise({
                    try: () => session.transcriptThread.send(FINAL_TRANSCRIPT_HEADER),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* appendTranscriptToThread(
                    session.transcriptThread,
                    transcript.trim().length > 0 ? transcript : NO_TRANSCRIPT_AVAILABLE,
                ).pipe(
                    Effect.catchAll((cause) =>
                        Effect.logWarning("meeting final transcript thread send failed", {
                            guild_id: session.guildId,
                            transcript_thread_id: session.transcriptThreadId,
                            error_message: safeString(cause),
                        }),
                    ),
                );

                if (notionEntry.pageUrl) {
                    yield* Effect.tryPromise({
                        try: () =>
                            session.transcriptThread.send(
                                `Meeting notes saved to Notion: ${notionEntry.pageUrl}`,
                            ),
                        catch: () => undefined,
                    }).pipe(Effect.ignore);
                }

                yield* Effect.tryPromise({
                    try: () => session.transcriptThread.setLocked(true, "Meeting ended"),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* Effect.tryPromise({
                    try: () => session.transcriptThread.setArchived(true, "Meeting ended"),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* Effect.logInfo("meeting finalization completed", {
                    guild_id: session.guildId,
                    channel_id: session.channelId,
                    transcript_thread_id: session.transcriptThreadId,
                    started_by_user_id: session.startedByUserId,
                    started_by_tag: session.startedByTag,
                    ended_reason: reason,
                    notion_page_url: notionEntry.pageUrl || null,
                    duration_ms: Date.now() - endStartedAt,
                });

                return notionEntry.pageUrl || null;
            },
        );

        const cleanupOrphanedConnection = Effect.fn("MeetingNotes.cleanupOrphanedConnection")(
            function* (guildId: Snowflake, connection: VoiceConnection) {
                const sessions = yield* SynchronizedRef.get(sessionsRef);
                const session = sessions.get(guildId);

                if (!session || session.connection !== connection) {
                    return;
                }

                yield* removeSessionFromMap(guildId);

                yield* Effect.tryPromise({
                    try: () => session.transcriber.stop(),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* cleanupSessionResources(session).pipe(Effect.ignore);
            },
        );

        const bindConnectionCleanup = (session: MeetingSession): void => {
            session.connection.once("error", () => {
                void Effect.runPromise(cleanupOrphanedConnection(session.guildId, session.connection));
            });

            session.connection.once(VoiceConnectionStatus.Destroyed, () => {
                void Effect.runPromise(cleanupOrphanedConnection(session.guildId, session.connection));
            });
        };

        const startMeeting = Effect.fn("MeetingNotes.startMeeting")(function* (input: StartMeetingInput) {
            if (!config.MEETING_NOTES_ENABLED) {
                return yield* Effect.fail(new FeatureDisabled({ feature: "meeting_notes" }));
            }

            if (config.ELEVENLABS_API_KEY.length === 0) {
                return yield* Effect.fail(
                    new MeetingTranscriptionError({
                        operation: "startMeeting.missingApiKey",
                        cause: new Error(
                            "ELEVENLABS_API_KEY is empty. Set ELEVENLABS_API_KEY to use meeting notes.",
                        ),
                    }),
                );
            }

            const existingSession = yield* SynchronizedRef.get(sessionsRef).pipe(
                Effect.map((sessions) => sessions.get(input.channel.guild.id)),
            );

            if (existingSession) {
                return yield* Effect.fail(
                    new MeetingAlreadyActive({
                        guildId: input.channel.guild.id,
                        activeChannelId: existingSession.channelId,
                    }),
                );
            }

            const connection = joinVoiceChannel({
                channelId: input.channel.id,
                guildId: input.channel.guild.id,
                adapterCreator: input.channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: true,
            });

            const readyResult = yield* Effect.tryPromise({
                try: () => entersState(connection, VoiceConnectionStatus.Ready, 15_000),
                catch: (cause) =>
                    new MeetingVoiceJoinFailed({
                        guildId: input.channel.guild.id,
                        channelId: input.channel.id,
                        cause,
                    }),
            }).pipe(Effect.either);

            if (readyResult._tag === "Left") {
                yield* Effect.sync(() => connection.destroy()).pipe(Effect.ignore);
                return yield* Effect.fail(readyResult.left);
            }

            const transcriptPubSub = yield* PubSub.bounded<TranscriptUpdate>(1_024);
            const hadHumanParticipantRef = yield* Ref.make(false);
            const endingRef = yield* Ref.make(false);
            const draftMessageIdRef = yield* Ref.make<Snowflake | null>(null);
            const draftTextRef = yield* Ref.make("");
            const committedTranscriptRef = yield* Ref.make<ReadonlyArray<string>>([]);

            const baseSession = {
                guildId: input.channel.guild.id,
                channelId: input.channel.id,
                transcriptThreadId: input.transcriptThread.id,
                transcriptThread: input.transcriptThread,
                connection,
                transcriptPubSub,
                hadHumanParticipantRef,
                endingRef,
                draftMessageIdRef,
                draftTextRef,
                committedTranscriptRef,
                startedAt: new Date(),
                startedByUserId: input.startedByUserId,
                startedByTag: input.startedByTag,
            };

            const liveConsumerFiber = yield* startLiveConsumer(baseSession);
            const committedConsumerFiber = yield* startCommittedConsumer(baseSession);

            const transcriberResult = yield* Effect.tryPromise({
                try: () =>
                    MeetingSpeechTranscriber.create({
                        connection,
                        elevenLabsApiKey: config.ELEVENLABS_API_KEY,
                        onTranscript: async (update) => {
                            await Effect.runPromise(
                                PubSub.publish(transcriptPubSub, update).pipe(
                                    Effect.catchAll(() => Effect.void),
                                ),
                            );
                        },
                    }),
                catch: (cause) =>
                    new MeetingTranscriptionError({ operation: "startMeeting.transcriberCreate", cause }),
            }).pipe(Effect.either);

            if (transcriberResult._tag === "Left") {
                yield* Fiber.interrupt(liveConsumerFiber).pipe(Effect.ignore);
                yield* Fiber.interrupt(committedConsumerFiber).pipe(Effect.ignore);
                yield* PubSub.shutdown(transcriptPubSub).pipe(Effect.ignore);
                yield* Effect.sync(() => connection.destroy()).pipe(Effect.ignore);
                return yield* Effect.fail(transcriberResult.left);
            }

            const transcriber = transcriberResult.right;

            let existingParticipantCount = 0;

            for (const member of input.channel.members.values()) {
                if (member.user.bot) {
                    continue;
                }

                transcriber.subscribeUser(member.id);
                existingParticipantCount += 1;
            }

            if (existingParticipantCount > 0) {
                yield* Ref.set(hadHumanParticipantRef, true);
            }

            const session: MeetingSession = {
                ...baseSession,
                liveConsumerFiber,
                committedConsumerFiber,
                transcriber,
            };

            bindConnectionCleanup(session);

            yield* SynchronizedRef.update(sessionsRef, (sessions) => {
                const nextSessions = new Map(sessions);
                nextSessions.set(input.channel.guild.id, session);
                return nextSessions;
            });

            yield* Effect.logInfo("meeting started", {
                guild_id: input.channel.guild.id,
                channel_id: input.channel.id,
                transcript_thread_id: input.transcriptThread.id,
                started_by_user_id: input.startedByUserId,
                started_by_tag: input.startedByTag,
                existing_participant_count: existingParticipantCount,
            });

            return {
                channelId: input.channel.id,
                transcriptThreadId: input.transcriptThread.id,
            };
        });

        const endMeeting = Effect.fn("MeetingNotes.endMeeting")(function* (input: EndMeetingInput) {
            const session = yield* SynchronizedRef.get(sessionsRef).pipe(
                Effect.map((sessions) => sessions.get(input.guildId)),
            );

            if (!session) {
                return yield* Effect.fail(new NoActiveMeeting({ guildId: input.guildId }));
            }

            const shouldFinalize = yield* Ref.modify(session.endingRef, (isEnding) => {
                if (isEnding) {
                    return [false, true] as const;
                }

                return [true, true] as const;
            });

            if (!shouldFinalize) {
                return {
                    channelId: session.channelId,
                    transcriptThreadId: session.transcriptThreadId,
                    notionPageUrl: null,
                    alreadyEnding: true,
                    reason: input.reason,
                } satisfies EndMeetingResult;
            }

            yield* removeSessionFromMap(input.guildId);

            const finalizeResult = yield* finalizeSession(session, input.reason).pipe(
                Effect.timed,
                Effect.either,
            );

            let notionPageUrl: string | null = null;
            let durationMs = 0;

            if (finalizeResult._tag === "Left") {
                yield* Effect.logError("meeting finalization failed", {
                    guild_id: session.guildId,
                    channel_id: session.channelId,
                    transcript_thread_id: session.transcriptThreadId,
                    ended_reason: input.reason,
                    error_message: safeString(finalizeResult.left),
                });
            } else {
                durationMs = Duration.toMillis(finalizeResult.right[0]);
                notionPageUrl = finalizeResult.right[1];
            }

            yield* Effect.logInfo("meeting ended", {
                guild_id: session.guildId,
                channel_id: session.channelId,
                transcript_thread_id: session.transcriptThreadId,
                ended_reason: input.reason,
                notion_page_url: notionPageUrl,
                duration_ms: durationMs,
            });

            return {
                channelId: session.channelId,
                transcriptThreadId: session.transcriptThreadId,
                notionPageUrl,
                alreadyEnding: false,
                reason: input.reason,
            } satisfies EndMeetingResult;
        });

        const countHumanParticipantsInChannel = (
            guild: Guild,
            channelId: Snowflake,
        ): number => {
            const channel = guild.channels.cache.get(channelId);

            if (!channel || !channel.isVoiceBased()) {
                return 0;
            }

            let participantCount = 0;

            for (const member of channel.members.values()) {
                if (!member.user.bot) {
                    participantCount += 1;
                }
            }

            return participantCount;
        };

        const handleVoiceStateUpdate = Effect.fn("MeetingNotes.handleVoiceStateUpdate")(
            function* (oldState: VoiceState, newState: VoiceState) {
                const session = yield* SynchronizedRef.get(sessionsRef).pipe(
                    Effect.map((sessions) => sessions.get(newState.guild.id)),
                );

                if (!session) {
                    return;
                }

                const affectedChannel =
                    oldState.channelId === session.channelId || newState.channelId === session.channelId;

                if (!affectedChannel) {
                    return;
                }

                if (newState.channelId === session.channelId && newState.member && !newState.member.user.bot) {
                    yield* Ref.set(session.hadHumanParticipantRef, true);
                    yield* Effect.sync(() => session.transcriber.subscribeUser(newState.id));
                }

                const humanParticipantCount = countHumanParticipantsInChannel(
                    newState.guild,
                    session.channelId,
                );

                if (humanParticipantCount > 0) {
                    yield* Ref.set(session.hadHumanParticipantRef, true);
                    return;
                }

                const hadHumanParticipant = yield* Ref.get(session.hadHumanParticipantRef);

                if (!hadHumanParticipant) {
                    return;
                }

                yield* endMeeting({
                    guildId: session.guildId,
                    reason: "auto_empty",
                }).pipe(Effect.catchAll(() => Effect.void));
            },
        );

        const hasMeeting = Effect.fn("MeetingNotes.hasMeeting")(function* (guildId: Snowflake) {
            const sessions = yield* SynchronizedRef.get(sessionsRef);
            return sessions.has(guildId);
        });

        const getMeetingChannelId = Effect.fn("MeetingNotes.getMeetingChannelId")(
            function* (guildId: Snowflake) {
                const sessions = yield* SynchronizedRef.get(sessionsRef);
                return sessions.get(guildId)?.channelId;
            },
        );

        const destroyAllSessions = Effect.fn("MeetingNotes.destroyAllSessions")(function* () {
            const sessions = Array.from((yield* SynchronizedRef.get(sessionsRef)).values());

            yield* SynchronizedRef.set(sessionsRef, new Map());

            yield* Effect.forEach(
                sessions,
                (session) =>
                    finalizeSession(session, "manual").pipe(
                        Effect.catchAll(() => Effect.void),
                    ),
                { concurrency: 1, discard: true },
            );
        });

        return {
            startMeeting,
            endMeeting,
            handleVoiceStateUpdate,
            hasMeeting,
            getMeetingChannelId,
            destroyAllSessions,
        } as const;
    }).pipe(Effect.annotateLogs({ service: "MeetingNotes" })),
}) {}
