import { entersState, joinVoiceChannel, VoiceConnectionStatus, type VoiceConnection } from "@discordjs/voice";
import type {
    Guild,
    GuildTextBasedChannel,
    Message,
    Snowflake,
    ThreadChannel,
    VoiceBasedChannel,
    VoiceState,
} from "discord.js";
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
const NO_TRANSCRIPT_AVAILABLE = "No final transcript was available for this meeting.";
const VOICE_TEXT_POINTER_MESSAGE =
    "Meeting is being recorded. Share text context here during the meeting; this message may be referenced in the final notes.";
const VOICE_TEXT_POINTER_SUMMARY_LABEL = "Voice chat text pointer";
const MEETING_TITLE_MODEL = "openai/gpt-oss-120b";

const NOTE_SYSTEM_PROMPT = `You are a meeting notes assistant.
Given a meeting transcript, produce concise notes in this exact format and order:

Meeting Notes

Summary
<content>

Decisions
<content>

Action Items
<content>

Open Questions
<content>

Rules:
- Use the exact section headings above.
- Do not add markdown heading markers like #.
- Do not add extra sections.
- Headings should be plain text in your response; formatting is applied downstream.
- Keep action items explicit and attributable when possible.
- If a section has no content, leave it blank.`;

const TITLE_SYSTEM_PROMPT = `You write short, human-readable Discord thread titles for finished meetings.
Rules:
- Return only the title text, no markdown or quotes.
- Keep it at most 90 characters.
- Make it specific to the topic.
- Include a date hint when helpful.`;

interface CommittedTranscriptSegment {
    readonly text: string;
    readonly speakerUserId: Snowflake | null;
}

interface MeetingSession {
    readonly guildId: Snowflake;
    readonly channelId: Snowflake;
    readonly transcriptThreadId: Snowflake;
    readonly transcriptThread: ThreadChannel;
    readonly notesMessageId: Snowflake | null;
    readonly connection: VoiceConnection;
    readonly transcriber: MeetingSpeechTranscriber;
    readonly transcriptPubSub: PubSub.PubSub<TranscriptUpdate>;
    readonly participantUsernamesRef: Ref.Ref<ReadonlyMap<Snowflake, string>>;
    readonly hadHumanParticipantRef: Ref.Ref<boolean>;
    readonly endingRef: Ref.Ref<boolean>;
    readonly draftMessageIdRef: Ref.Ref<Snowflake | null>;
    readonly draftTextRef: Ref.Ref<string>;
    readonly liveTranscriptMessageIdsRef: Ref.Ref<ReadonlyArray<Snowflake>>;
    readonly committedTranscriptRef: Ref.Ref<ReadonlyArray<CommittedTranscriptSegment>>;
    readonly voiceTextPointerMessageId: Snowflake | null;
    readonly liveConsumerFiber: Fiber.RuntimeFiber<void, never>;
    readonly committedConsumerFiber: Fiber.RuntimeFiber<void, never>;
    readonly startedAt: Date;
    readonly startedByUserId: string;
    readonly startedByTag: string;
}

interface StartMeetingInput {
    readonly channel: VoiceBasedChannel;
    readonly transcriptThread: ThreadChannel;
    readonly notesMessageId: Snowflake | null;
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

const formatSpeakerTranscript = (
    segments: ReadonlyArray<SpeakerTranscriptSegment>,
    speakerNameMap: ReadonlyMap<string, string>,
): string => {
    if (segments.length === 0) {
        return "";
    }

    return segments
        .map((segment) => {
            const speakerName = speakerNameMap.get(segment.speakerId) ?? segment.speakerId;
            return `[${speakerName}] ${segment.text}`;
        })
        .join("\n");
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

const sanitizeThreadTitle = (title: string): string => {
    const withoutQuotes = title.trim().replace(/^['"`]+|['"`]+$/g, "");
    const singleLine = withoutQuotes.replace(/\s+/g, " ").trim();
    return singleLine.slice(0, 100);
};

type MeetingNoteSection = "summary" | "decisions" | "action_items" | "open_questions";

const normalizeMeetingNotesHeading = (line: string): string => {
    return line
        .trim()
        .replace(/[*_`]/g, "")
        .replace(/^#+\s*/, "")
        .replace(/:$/, "")
        .replace(/\s+/g, " ")
        .toLowerCase();
};

const normalizeMeetingNotesOutput = (rawNotes: string, voiceTextPointerUrl: string | null): string => {
    const sections: Record<MeetingNoteSection, Array<string>> = {
        summary: [],
        decisions: [],
        action_items: [],
        open_questions: [],
    };

    const sectionLookup: Record<string, MeetingNoteSection> = {
        summary: "summary",
        decisions: "decisions",
        "action items": "action_items",
        "action item": "action_items",
        "open questions": "open_questions",
        "open question": "open_questions",
    };

    const lines = rawNotes.replace(/\r\n/g, "\n").split("\n");
    let currentSection: MeetingNoteSection = "summary";
    let sawSectionHeading = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
            sections[currentSection].push("");
            continue;
        }

        const normalizedHeading = normalizeMeetingNotesHeading(trimmed);
        if (normalizedHeading === "meeting notes") {
            sawSectionHeading = true;
            continue;
        }

        const matchedSection = sectionLookup[normalizedHeading];
        if (matchedSection) {
            currentSection = matchedSection;
            sawSectionHeading = true;
            continue;
        }

        sections[currentSection].push(line.trimEnd());
    }

    if (!sawSectionHeading && rawNotes.trim().length > 0) {
        sections.summary = [rawNotes.trim()];
        sections.decisions = [];
        sections.action_items = [];
        sections.open_questions = [];
    }

    if (
        voiceTextPointerUrl &&
        !sections.summary.some((line) => line.includes(voiceTextPointerUrl))
    ) {
        if (sections.summary.length > 0 && sections.summary[sections.summary.length - 1]?.trim().length > 0) {
            sections.summary.push("");
        }
        sections.summary.push(`${VOICE_TEXT_POINTER_SUMMARY_LABEL}: ${voiceTextPointerUrl}`);
    }

    const collapseSection = (section: ReadonlyArray<string>): string => {
        return section.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    };

    return [
        "**Meeting Notes**",
        "",
        "**Summary**",
        collapseSection(sections.summary),
        "",
        "**Decisions**",
        collapseSection(sections.decisions),
        "",
        "**Action Items**",
        collapseSection(sections.action_items),
        "",
        "**Open Questions**",
        collapseSection(sections.open_questions),
    ].join("\n");
};

const usernameFromTag = (tag: string): string => {
    return tag.split("#")[0] ?? tag;
};

const buildSpeakerNameMap = (
    segments: ReadonlyArray<SpeakerTranscriptSegment>,
    participantUsernames: ReadonlyArray<string>,
    startedByTag: string,
): ReadonlyMap<string, string> => {
    const uniqueSpeakerIds: string[] = [];

    for (const segment of segments) {
        if (
            segment.speakerId.length > 0 &&
            !uniqueSpeakerIds.includes(segment.speakerId)
        ) {
            uniqueSpeakerIds.push(segment.speakerId);
        }
    }

    const uniqueUsernames = Array.from(new Set(participantUsernames));

    if (uniqueSpeakerIds.length === 0 || uniqueUsernames.length === 0) {
        return new Map();
    }

    if (uniqueUsernames.length === 1) {
        const map = new Map<string, string>();
        for (const speakerId of uniqueSpeakerIds) {
            map.set(speakerId, uniqueUsernames[0]!);
        }
        return map;
    }

    if (uniqueSpeakerIds.length === 1) {
        const startedByUsername = usernameFromTag(startedByTag);
        const preferredUsername = uniqueUsernames.includes(startedByUsername)
            ? startedByUsername
            : uniqueUsernames[0]!;
        return new Map([[uniqueSpeakerIds[0]!, preferredUsername]]);
    }

    if (uniqueSpeakerIds.length === uniqueUsernames.length) {
        const map = new Map<string, string>();
        for (let index = 0; index < uniqueSpeakerIds.length; index += 1) {
            map.set(uniqueSpeakerIds[index]!, uniqueUsernames[index]!);
        }
        return map;
    }

    return new Map();
};

const formatCommittedTranscript = (
    segments: ReadonlyArray<CommittedTranscriptSegment>,
    participantUsernamesById: ReadonlyMap<Snowflake, string>,
    startedByTag: string,
): string => {
    if (segments.length === 0) {
        return "";
    }

    const uniqueUsernames = Array.from(new Set(participantUsernamesById.values()));
    const singleUsername = uniqueUsernames.length === 1 ? uniqueUsernames[0] : null;
    const startedByUsername = usernameFromTag(startedByTag);
    const fallbackUsername =
        singleUsername ?? (uniqueUsernames.includes(startedByUsername) ? startedByUsername : null);

    return segments
        .map((segment) => {
            const speakerName =
                (segment.speakerUserId
                    ? participantUsernamesById.get(segment.speakerUserId)
                    : null) ?? fallbackUsername;

            if (!speakerName) {
                return segment.text;
            }

            return `[${speakerName}] ${segment.text}`;
        })
        .join("\n");
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

        const appendLiveTranscriptToThread = Effect.fn("MeetingNotes.appendLiveTranscriptToThread")(
            function* (session: MeetingSession, transcriptText: string) {
                const trimmedTranscript = transcriptText.trim();
                if (!trimmedTranscript) {
                    return;
                }

                const chunks = chunkTranscript(trimmedTranscript);

                yield* Effect.forEach(
                    chunks,
                    (chunk) =>
                        Effect.gen(function* () {
                            const sentMessage = yield* Effect.tryPromise({
                                try: () => session.transcriptThread.send(chunk),
                                catch: (cause) =>
                                    new MeetingTranscriptionError({
                                        operation: "appendLiveTranscriptToThread.send",
                                        cause,
                                    }),
                            });

                            yield* Ref.update(session.liveTranscriptMessageIdsRef, (messageIds) => [
                                ...messageIds,
                                sentMessage.id,
                            ]);
                        }),
                    { concurrency: 1, discard: true },
                );
            },
        );

        const clearLiveTranscriptMessages = Effect.fn("MeetingNotes.clearLiveTranscriptMessages")(
            function* (session: MeetingSession) {
                const messageIds = yield* Ref.get(session.liveTranscriptMessageIdsRef);

                if (messageIds.length === 0) {
                    return;
                }

                const uniqueMessageIds = Array.from(new Set(messageIds));

                yield* Effect.forEach(
                    uniqueMessageIds,
                    (messageId) =>
                        Effect.tryPromise({
                            try: () => session.transcriptThread.messages.delete(messageId),
                            catch: () => undefined,
                        }).pipe(Effect.ignore),
                    { concurrency: 1, discard: true },
                );

                yield* Ref.set(session.liveTranscriptMessageIdsRef, []);
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

                    yield* Ref.update(session.liveTranscriptMessageIdsRef, (messageIds) => [
                        ...messageIds,
                        sentMessage.id,
                    ]);
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
                            Stream.map((update) => ({
                                text: update.text.trim(),
                                speakerUserId: update.speakerUserId,
                            })),
                            Stream.filter((update) => update.text.length > 0),
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
                                    yield* appendLiveTranscriptToThread(
                                        session as MeetingSession,
                                        segment.text,
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
                yield* clearLiveTranscriptMessages(session).pipe(Effect.ignore);
            },
        );

        const buildFinalTranscript = Effect.fn("MeetingNotes.buildFinalTranscript")(
            function* (session: MeetingSession, recordingPath: string | null) {
                const committedSegments = yield* Ref.get(session.committedTranscriptRef);
                const participantUsernamesById = yield* Ref.get(session.participantUsernamesRef);
                const committedWithSpeakerNames = formatCommittedTranscript(
                    committedSegments,
                    participantUsernamesById,
                    session.startedByTag,
                );
                const committedTextOnly = committedSegments.map((segment) => segment.text).join("\n");
                const committedFallback =
                    committedWithSpeakerNames.trim().length > 0 ? committedWithSpeakerNames : committedTextOnly;

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
                const speakerNameMap = buildSpeakerNameMap(
                    diarized.segments,
                    Array.from(participantUsernamesById.values()),
                    session.startedByTag,
                );
                const formattedTranscript = formatSpeakerTranscript(diarized.segments, speakerNameMap);

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

        const fetchUserMessagesInWindow = Effect.fn("MeetingNotes.fetchUserMessagesInWindow")(
            function* (options: {
                readonly channel: GuildTextBasedChannel | ThreadChannel;
                readonly startedAtTimestamp: number;
                readonly endedAtTimestamp: number;
                readonly operation: string;
                readonly excludedMessageIds?: ReadonlySet<Snowflake>;
            }) {
                const messages: Array<Message<true>> = [];
                let before: Snowflake | undefined;
                let reachedStartedAtBoundary = false;

                while (messages.length < 300 && !reachedStartedAtBoundary) {
                    const batch = yield* Effect.tryPromise({
                        try: () =>
                            options.channel.messages.fetch({
                                limit: 100,
                                ...(before ? { before } : {}),
                            }),
                        catch: (cause) =>
                            new MeetingTranscriptionError({
                                operation: options.operation,
                                cause,
                            }),
                    });

                    if (batch.size === 0) {
                        break;
                    }

                    const orderedBatch = Array.from(batch.values()).sort(
                        (left, right) => right.createdTimestamp - left.createdTimestamp,
                    );

                    for (const message of orderedBatch) {
                        if (message.createdTimestamp > options.endedAtTimestamp) {
                            continue;
                        }

                        if (message.createdTimestamp < options.startedAtTimestamp) {
                            reachedStartedAtBoundary = true;
                            continue;
                        }

                        if (message.author.bot) {
                            continue;
                        }

                        if (options.excludedMessageIds?.has(message.id)) {
                            continue;
                        }

                        messages.push(message);
                        if (messages.length >= 300) {
                            break;
                        }
                    }

                    const oldestMessage = orderedBatch.at(-1);
                    if (!oldestMessage) {
                        break;
                    }

                    before = oldestMessage.id;
                    if (oldestMessage.createdTimestamp < options.startedAtTimestamp) {
                        reachedStartedAtBoundary = true;
                    }
                }

                return messages.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
            },
        );

        const createVoiceTextPointerMessage = Effect.fn("MeetingNotes.createVoiceTextPointerMessage")(
            function* (channel: VoiceBasedChannel) {
                if (!channel.isTextBased()) {
                    return null;
                }

                const pointerMessage = yield* Effect.tryPromise({
                    try: () => channel.send(VOICE_TEXT_POINTER_MESSAGE),
                    catch: () => null,
                });

                if (!pointerMessage || !pointerMessage.inGuild()) {
                    return null;
                }

                return pointerMessage.id;
            },
        );

        const finalizeVoiceTextPointer = Effect.fn("MeetingNotes.finalizeVoiceTextPointer")(
            function* (session: MeetingSession, meetingEndedAtTimestamp: number) {
                const pointerMessageId = session.voiceTextPointerMessageId;
                if (!pointerMessageId) {
                    return null;
                }

                const voiceChannel = yield* Effect.tryPromise({
                    try: () => session.transcriptThread.guild.channels.fetch(session.channelId),
                    catch: () => null,
                });

                if (!voiceChannel || !voiceChannel.isTextBased()) {
                    return null;
                }

                const pointerMessage = yield* Effect.tryPromise({
                    try: () => voiceChannel.messages.fetch(pointerMessageId),
                    catch: () => null,
                });

                if (!pointerMessage || !pointerMessage.inGuild()) {
                    return null;
                }

                const textMessages = yield* fetchUserMessagesInWindow({
                    channel: voiceChannel,
                    startedAtTimestamp: pointerMessage.createdTimestamp + 1,
                    endedAtTimestamp: meetingEndedAtTimestamp,
                    operation: "finalizeVoiceTextPointer.fetchTextMessages",
                    excludedMessageIds: new Set([pointerMessageId]),
                }).pipe(
                    Effect.catchAll(() => Effect.succeed([] as Array<Message<true>>)),
                );

                const hasTextActivity = textMessages.some((message) => {
                    return message.content.trim().length > 0;
                });

                if (!hasTextActivity) {
                    yield* Effect.tryPromise({
                        try: () => pointerMessage.delete(),
                        catch: () => undefined,
                    }).pipe(Effect.ignore);
                }

                yield* Effect.logInfo("meeting voice text pointer finalized", {
                    guild_id: session.guildId,
                    channel_id: session.channelId,
                    transcript_thread_id: session.transcriptThreadId,
                    voice_text_pointer_message_id: pointerMessageId,
                    kept: hasTextActivity,
                    text_activity_count: textMessages.length,
                });

                return hasTextActivity ? pointerMessage.url : null;
            },
        );

        const summarizeMeetingNotes = Effect.fn("MeetingNotes.summarizeMeetingNotes")(
            function* (session: MeetingSession, transcript: string, voiceTextPointerUrl: string | null) {
                const userPrompt = [
                    `Meeting directory: ${MEETING_NOTES_DEFAULT_DIRECTORY}`,
                    `Guild ID: ${session.guildId}`,
                    `Voice Channel ID: ${session.channelId}`,
                    `Transcript Thread ID: ${session.transcriptThreadId}`,
                    "",
                    "Transcript:",
                    transcript.trim().length > 0 ? transcript : NO_TRANSCRIPT_AVAILABLE,
                    "",
                    `${VOICE_TEXT_POINTER_SUMMARY_LABEL}:`,
                    voiceTextPointerUrl ?? "None",
                ].join("\n");

                return yield* ai.chat({
                    systemPrompt: NOTE_SYSTEM_PROMPT,
                    userPrompt,
                });
            },
        );

        const generateFinalMeetingTitle = Effect.fn("MeetingNotes.generateFinalMeetingTitle")(
            function* (session: MeetingSession, notes: string, transcript: string) {
                const fallbackTitle = sanitizeThreadTitle(
                    `Meeting ${session.startedAt.toISOString().slice(0, 10)}`,
                );

                const userPrompt = [
                    `Meeting started at: ${session.startedAt.toISOString()}`,
                    `Recording thread title: ${session.transcriptThread.name}`,
                    `Voice channel id: ${session.channelId}`,
                    "",
                    "Notes excerpt:",
                    notes.slice(0, 2_000),
                    "",
                    "Transcript excerpt:",
                    transcript.slice(0, 2_000),
                    "",
                    "Return exactly one title line.",
                ].join("\n");

                const generatedTitle = yield* ai
                    .chat({
                        model: MEETING_TITLE_MODEL,
                        systemPrompt: TITLE_SYSTEM_PROMPT,
                        userPrompt,
                    })
                    .pipe(
                        Effect.catchAll(() => Effect.succeed(fallbackTitle)),
                    );

                const sanitized = sanitizeThreadTitle(generatedTitle);
                if (sanitized.length === 0) {
                    return fallbackTitle;
                }

                return sanitized;
            },
        );

        const upsertFinalNotesMessage = Effect.fn("MeetingNotes.upsertFinalNotesMessage")(
            function* (session: MeetingSession, notes: string) {
                const trimmedNotes = notes.trim();

                if (trimmedNotes.length === 0) {
                    return;
                }

                const chunks = chunkTranscript(trimmedNotes);
                const [firstChunk, ...remainingChunks] = chunks;

                if (!firstChunk) {
                    return;
                }

                if (session.notesMessageId) {
                    const notesMessageId = session.notesMessageId;
                    const edited = yield* Effect.tryPromise({
                        try: () => session.transcriptThread.messages.edit(notesMessageId, firstChunk),
                        catch: () => null,
                    });

                    if (edited !== null) {
                        yield* Effect.forEach(
                            remainingChunks,
                            (chunk) =>
                                Effect.tryPromise({
                                    try: () => session.transcriptThread.send(chunk),
                                    catch: (cause) =>
                                        new MeetingTranscriptionError({
                                            operation: "upsertFinalNotesMessage.sendRemainingChunk",
                                            cause,
                                        }),
                                }),
                            { concurrency: 1, discard: true },
                        );

                        return;
                    }
                }

                yield* appendTranscriptToThread(session.transcriptThread, trimmedNotes);
            },
        );

        const finalizeSession = Effect.fn("MeetingNotes.finalizeSession")(
            function* (session: MeetingSession, reason: "manual" | "auto_empty") {
                const endStartedAt = Date.now();
                const meetingEndedAtTimestamp = endStartedAt;

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
                const voiceTextPointerUrl = yield* finalizeVoiceTextPointer(
                    session,
                    meetingEndedAtTimestamp,
                ).pipe(
                    Effect.catchAll((cause) =>
                        Effect.gen(function* () {
                            yield* Effect.logWarning("meeting voice text pointer finalize failed", {
                                guild_id: session.guildId,
                                channel_id: session.channelId,
                                transcript_thread_id: session.transcriptThreadId,
                                error_message: safeString(cause),
                            });

                            return null;
                        }),
                    ),
                );
                const notes = yield* summarizeMeetingNotes(
                    session,
                    transcript,
                    voiceTextPointerUrl,
                ).pipe(
                    Effect.catchAll((cause) =>
                        Effect.succeed(
                            `Summary generation failed.\n\nError: ${safeString(cause)}\n\nTranscript fallback:\n${transcript || NO_TRANSCRIPT_AVAILABLE}`,
                        ),
                    ),
                );
                const normalizedNotes = normalizeMeetingNotesOutput(notes, voiceTextPointerUrl);

                const title = yield* generateFinalMeetingTitle(session, normalizedNotes, transcript);

                yield* Effect.tryPromise({
                    try: () => session.transcriptThread.setName(title, "Meeting ended"),
                    catch: () => undefined,
                }).pipe(Effect.ignore);

                yield* upsertFinalNotesMessage(session, normalizedNotes).pipe(
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
                                content: normalizedNotes,
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
                    final_thread_name: title,
                    started_by_user_id: session.startedByUserId,
                    started_by_tag: session.startedByTag,
                    ended_reason: reason,
                    notion_page_url: notionEntry.pageUrl || null,
                    voice_text_pointer_url: voiceTextPointerUrl,
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

            const initialParticipantUsernames = new Map<Snowflake, string>();

            for (const member of input.channel.members.values()) {
                if (member.user.bot) {
                    continue;
                }

                initialParticipantUsernames.set(member.id, member.user.username);
            }

            const voiceTextPointerMessageId = yield* createVoiceTextPointerMessage(input.channel).pipe(
                Effect.catchAll((cause) =>
                    Effect.gen(function* () {
                        yield* Effect.logWarning("meeting voice text pointer send failed", {
                            guild_id: input.channel.guild.id,
                            channel_id: input.channel.id,
                            transcript_thread_id: input.transcriptThread.id,
                            error_message: safeString(cause),
                        });
                        return null;
                    }),
                ),
            );

            const transcriptPubSub = yield* PubSub.bounded<TranscriptUpdate>(1_024);
            const participantUsernamesRef = yield* Ref.make<ReadonlyMap<Snowflake, string>>(
                initialParticipantUsernames,
            );
            const hadHumanParticipantRef = yield* Ref.make(false);
            const endingRef = yield* Ref.make(false);
            const draftMessageIdRef = yield* Ref.make<Snowflake | null>(null);
            const draftTextRef = yield* Ref.make("");
            const liveTranscriptMessageIdsRef = yield* Ref.make<ReadonlyArray<Snowflake>>([]);
            const committedTranscriptRef = yield* Ref.make<ReadonlyArray<CommittedTranscriptSegment>>(
                [],
            );

            const baseSession = {
                guildId: input.channel.guild.id,
                channelId: input.channel.id,
                transcriptThreadId: input.transcriptThread.id,
                transcriptThread: input.transcriptThread,
                notesMessageId: input.notesMessageId,
                connection,
                transcriptPubSub,
                participantUsernamesRef,
                hadHumanParticipantRef,
                endingRef,
                draftMessageIdRef,
                draftTextRef,
                liveTranscriptMessageIdsRef,
                committedTranscriptRef,
                voiceTextPointerMessageId,
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
                if (voiceTextPointerMessageId && input.channel.isTextBased()) {
                    yield* Effect.tryPromise({
                        try: () => input.channel.messages.delete(voiceTextPointerMessageId),
                        catch: () => undefined,
                    }).pipe(Effect.ignore);
                }
                return yield* Effect.fail(transcriberResult.left);
            }

            const transcriber = transcriberResult.right;

            let existingParticipantCount = 0;

            for (const memberId of initialParticipantUsernames.keys()) {
                transcriber.subscribeUser(memberId);
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
                voice_text_pointer_message_id: voiceTextPointerMessageId,
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
                    const joinedMember = newState.member;
                    yield* Ref.set(session.hadHumanParticipantRef, true);
                    yield* Ref.update(session.participantUsernamesRef, (currentUsernames) => {
                        const nextUsernames = new Map(currentUsernames);
                        nextUsernames.set(newState.id, joinedMember.user.username);
                        return nextUsernames;
                    });
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
