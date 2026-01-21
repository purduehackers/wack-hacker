import { MessageFlags, type Message } from "discord.js";
import { Duration, Effect } from "effect";

import { DiscordReactError, DiscordReplyError } from "../../errors";
import { AI } from "../../services";

export const handleVoiceTranscription = Effect.fn("VoiceTranscription.handle")(
    function* (message: Message) {
        const startTime = yield* Effect.sync(() => Date.now());
        const ai = yield* AI;

        if (message.author.bot) {
            yield* Effect.logDebug("voice transcription skipped bot message", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                reason: "author_is_bot",
            });
            return;
        }

        if (message.channel.isDMBased()) {
            yield* Effect.logDebug("voice transcription skipped dm message", {
                user_id: message.author.id,
                message_id: message.id,
                reason: "dm_channel",
            });
            return;
        }

        if (!message.flags.has(MessageFlags.IsVoiceMessage)) {
            yield* Effect.logDebug("voice transcription skipped non-voice message", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                reason: "not_voice_message",
            });
            return;
        }

        yield* Effect.annotateCurrentSpan({
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            guild_id: message.guildId ?? "unknown",
        });

        yield* Effect.logInfo("voice transcription started", {
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            guild_id: message.guildId ?? "unknown",
            username: message.author.username,
        });

        yield* Effect.tryPromise({
            try: () => message.react("\u{1F399}\u{FE0F}"),
            catch: (cause) =>
                new DiscordReactError({ messageId: message.id, emoji: "microphone", cause }),
        }).pipe(
            Effect.timed,
            Effect.tap(([duration]) =>
                Effect.logDebug("reaction added", {
                    user_id: message.author.id,
                    channel_id: message.channelId,
                    message_id: message.id,
                    duration_ms: Duration.toMillis(duration),
                    emoji: "microphone",
                }),
            ),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    yield* Effect.logWarning("reaction failed", {
                        user_id: message.author.id,
                        channel_id: message.channelId,
                        message_id: message.id,
                        error_message: error.message,
                    });
                    return [Duration.millis(0)] as const;
                }),
            ),
        );

        const audioFile = message.attachments.find((m) => m.name === "voice-message.ogg");
        if (!audioFile) {
            yield* Effect.logWarning("voice transcription failed no audio attachment", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                attachments_count: message.attachments.size,
                attachment_names: Array.from(message.attachments.values())
                    .map((a) => a.name)
                    .join(","),
            });
            return;
        }

        const fileSizeBytes = audioFile.size;
        yield* Effect.annotateCurrentSpan({
            file_size_bytes: fileSizeBytes,
            audio_url: audioFile.url,
        });

        yield* Effect.logDebug("audio file found", {
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            file_size_bytes: fileSizeBytes,
            file_name: audioFile.name,
            content_type: audioFile.contentType ?? "unknown",
        });

        const [transcriptionDuration, transcription] = yield* ai.transcribe(audioFile.url).pipe(
            Effect.timed,
            Effect.tap(([duration, result]) =>
                Effect.logDebug("transcription api call completed", {
                    user_id: message.author.id,
                    channel_id: message.channelId,
                    message_id: message.id,
                    duration_ms: Duration.toMillis(duration),
                    transcription_length: result?.length ?? 0,
                    file_size_bytes: fileSizeBytes,
                }),
            ),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    const totalDuration = Date.now() - startTime;
                    yield* Effect.logError("voice transcription failed transcription error", {
                        user_id: message.author.id,
                        channel_id: message.channelId,
                        message_id: message.id,
                        file_size_bytes: fileSizeBytes,
                        duration_ms: totalDuration,
                        error_type: error._tag,
                        error_message:
                            "cause" in error && error.cause
                                ? error.cause instanceof Error
                                    ? error.cause.message
                                    : JSON.stringify(error.cause)
                                : "unknown",
                    });

                    yield* Effect.tryPromise({
                        try: () =>
                            message.reply({
                                content: "Sorry, I couldn't transcribe that audio message.",
                            }),
                        catch: (cause) => new DiscordReplyError({ messageId: message.id, cause }),
                    }).pipe(
                        Effect.catchAll((replyError) =>
                            Effect.logError("failed to send error reply", {
                                user_id: message.author.id,
                                channel_id: message.channelId,
                                message_id: message.id,
                                error_message: replyError.message,
                            }),
                        ),
                    );

                    return yield* Effect.fail(error);
                }),
            ),
        );

        if (!transcription) {
            const totalDuration = Date.now() - startTime;
            yield* Effect.logWarning("voice transcription empty result", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                file_size_bytes: fileSizeBytes,
                transcription_duration_ms: Duration.toMillis(transcriptionDuration),
                total_duration_ms: totalDuration,
            });

            yield* Effect.tryPromise({
                try: () =>
                    message.reply({
                        content: "Sorry, I couldn't transcribe that audio message.",
                    }),
                catch: (cause) => new DiscordReplyError({ messageId: message.id, cause }),
            }).pipe(
                Effect.catchAll((error) =>
                    Effect.logError("failed to send empty result reply", {
                        user_id: message.author.id,
                        channel_id: message.channelId,
                        message_id: message.id,
                        error_message: error.message,
                    }),
                ),
            );
            return;
        }

        const transcriptionLength = transcription.trim().length;
        const wordCount = transcription.trim().split(/\s+/).length;

        yield* Effect.annotateCurrentSpan({
            transcription_length: transcriptionLength,
            word_count: wordCount,
        });

        const [replyDuration] = yield* Effect.tryPromise({
            try: () =>
                message.reply({
                    content: transcription.trim(),
                }),
            catch: (cause) => new DiscordReplyError({ messageId: message.id, cause }),
        }).pipe(
            Effect.timed,
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    yield* Effect.logError("voice transcription failed to send reply", {
                        user_id: message.author.id,
                        channel_id: message.channelId,
                        message_id: message.id,
                        transcription_length: transcriptionLength,
                        error_message: error.message,
                    });
                    return yield* Effect.fail(error);
                }),
            ),
        );

        const totalDuration = Date.now() - startTime;

        yield* Effect.logInfo("voice transcription completed", {
            user_id: message.author.id,
            username: message.author.username,
            channel_id: message.channelId,
            message_id: message.id,
            guild_id: message.guildId ?? "unknown",
            file_size_bytes: fileSizeBytes,
            transcription_length: transcriptionLength,
            word_count: wordCount,
            transcription_duration_ms: Duration.toMillis(transcriptionDuration),
            reply_duration_ms: Duration.toMillis(replyDuration),
            total_duration_ms: totalDuration,
            status: "success",
        });
    },
    Effect.annotateLogs({ feature: "voice_transcription" }),
);
