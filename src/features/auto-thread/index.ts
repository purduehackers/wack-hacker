import type { Message } from "discord.js";

import { Effect } from "effect";

import {
    SHIP_CHANNEL_ID,
    CHECKPOINTS_CHANNEL_ID,
    WACKY_ROLE_ID,
    SIGHORSE_CATEGORY_ID,
    AUTO_THREAD_CHANNELS,
    CHECKPOINT_RESPONSE_MESSAGES,
    SHIP_RESPONSE_MESSAGES,
} from "../../constants";
import { randomItem, containsUrl } from "../../lib/discord";

export const handleAutoThread = Effect.fn("AutoThread.handle")(
    function* (message: Message) {
        const startTime = Date.now();

        if (message.author.bot) {
            yield* Effect.logDebug("message ignored bot author", {
                channel_id: message.channelId,
                message_id: message.id,
                author_id: message.author.id,
                is_bot: true,
            });
            return;
        }

        if (message.channel.isDMBased()) {
            yield* Effect.logDebug("message ignored dm channel", {
                channel_id: message.channelId,
                message_id: message.id,
                author_id: message.author.id,
                is_dm: true,
            });
            return;
        }

        if (!(AUTO_THREAD_CHANNELS as readonly string[]).includes(message.channelId)) {
            yield* Effect.logDebug("message ignored not auto thread channel", {
                channel_id: message.channelId,
                message_id: message.id,
                author_id: message.author.id,
                is_auto_thread_channel: false,
            });
            return;
        }

        yield* Effect.logInfo("auto thread processing started", {
            channel_id: message.channelId,
            message_id: message.id,
            user_id: message.author.id,
            user_display_name: message.author.displayName,
            guild_id: message.guildId,
        });

        yield* Effect.annotateCurrentSpan({
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
            guildId: message.guildId,
        });

        const hasProjectLink = containsUrl(message.content);
        const hasAttachment = message.attachments.size > 0;

        yield* Effect.logDebug("message content analyzed", {
            channel_id: message.channelId,
            message_id: message.id,
            user_id: message.author.id,
            has_project_link: hasProjectLink,
            has_attachment: hasAttachment,
            attachment_count: message.attachments.size,
            content_length: message.content.length,
        });

        let isSIGHORSECheckpoint = false;
        if (message.reference) {
            const refStartTime = Date.now();
            yield* Effect.logDebug("fetching message reference", {
                channel_id: message.channelId,
                message_id: message.id,
                user_id: message.author.id,
                reference_message_id: message.reference.messageId,
            });

            const ref = yield* Effect.tryPromise({
                try: () => message.fetchReference(),
                catch: () => null,
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (ref && !ref.channel.isDMBased() && ref.channel.parentId === SIGHORSE_CATEGORY_ID) {
                isSIGHORSECheckpoint = true;
                yield* Effect.logInfo("sighorse checkpoint detected", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    user_id: message.author.id,
                    reference_message_id: message.reference.messageId,
                    reference_channel_id: ref.channelId,
                    parent_category_id: ref.channel.parentId,
                    duration_ms: Date.now() - refStartTime,
                });
            } else if (ref) {
                yield* Effect.logDebug("message reference fetched not sighorse", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    user_id: message.author.id,
                    reference_message_id: message.reference.messageId,
                    reference_channel_id: ref.channelId,
                    is_sighorse: false,
                    duration_ms: Date.now() - refStartTime,
                });
            } else {
                yield* Effect.logDebug("message reference fetch failed", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    user_id: message.author.id,
                    reference_message_id: message.reference.messageId,
                    duration_ms: Date.now() - refStartTime,
                });
            }
        }

        if (!hasProjectLink && !hasAttachment && !isSIGHORSECheckpoint) {
            const deleteStartTime = Date.now();
            yield* Effect.logInfo("message violates auto thread requirements deleting", {
                channel_id: message.channelId,
                message_id: message.id,
                user_id: message.author.id,
                has_project_link: false,
                has_attachment: false,
                is_sighorse_checkpoint: false,
            });

            yield* Effect.tryPromise({
                try: () => message.delete(),
                catch: (e) => new Error(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logInfo("message deleted successfully", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        duration_ms: Date.now() - deleteStartTime,
                    })
                ),
                Effect.catchAll((error) =>
                    Effect.logError("message deletion failed", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        error_message: error.message,
                        duration_ms: Date.now() - deleteStartTime,
                    })
                ),
            );

            const reminderMessage =
                `Hey there, it looks like you tried to send a message in <#${message.channelId}> without an attachment or URL!! D:\n\n` +
                `It's okay!! I saved your message for you!! \u{1F643}\u{200D}\u{2195}\u{FE0F}\n\n` +
                `\`\`\`${message.content}\`\`\`\n\n` +
                `- If you meant to reply to someone, send your message in the corresponding thread!\n` +
                `- If you meant checkpoint or ship a project, add an attachment or URL so people can see your work :D\n` +
                `- If you think this action was done in error, ping <@636701123620634653> and let them know!\n\n` +
                `Cheers! ^•^`;

            const dmStartTime = Date.now();
            yield* Effect.tryPromise({
                try: () => message.author.send(reminderMessage),
                catch: (e) => new Error(`Failed to DM: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logInfo("reminder dm sent successfully", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        duration_ms: Date.now() - dmStartTime,
                        total_duration_ms: Date.now() - startTime,
                    })
                ),
                Effect.catchAll((error) =>
                    Effect.logWarning("reminder dm send failed user may have dms disabled", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        error_message: error.message,
                        duration_ms: Date.now() - dmStartTime,
                        total_duration_ms: Date.now() - startTime,
                    })
                ),
            );
            return;
        }

        yield* Effect.sleep("1 second");

        const threadStartTime = Date.now();
        const threadName = `${message.author.displayName} - ${message.cleanContent.slice(0, 54)}`;

        yield* Effect.logInfo("creating thread", {
            channel_id: message.channelId,
            message_id: message.id,
            user_id: message.author.id,
            thread_name: threadName,
            thread_name_length: threadName.length,
        });

        const thread = yield* Effect.tryPromise({
            try: () =>
                message.startThread({
                    name: threadName,
                }),
            catch: (e) => new Error(`Failed to start thread: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.tap((thread) =>
                Effect.gen(function* () {
                    yield* Effect.logInfo("thread created successfully", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_id: thread.id,
                        thread_name: thread.name,
                        auto_archive_duration: thread.autoArchiveDuration,
                        duration_ms: Date.now() - threadStartTime,
                    });
                    yield* Effect.annotateCurrentSpan({
                        threadId: thread.id,
                        threadName: thread.name,
                        autoArchiveDuration: thread.autoArchiveDuration,
                    });
                })
            ),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    yield* Effect.logError("thread creation failed", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_name: threadName,
                        error_message: error.message,
                        duration_ms: Date.now() - threadStartTime,
                    });
                    return yield* Effect.fail(error);
                })
            ),
        );

        const hasWackyRole = message.member?.roles.cache.has(WACKY_ROLE_ID);

        yield* Effect.annotateCurrentSpan({
            hasWackyRole,
            isCheckpoint: message.channelId === CHECKPOINTS_CHANNEL_ID,
            isShip: message.channelId === SHIP_CHANNEL_ID,
        });

        if (message.channelId === CHECKPOINTS_CHANNEL_ID && hasWackyRole) {
            const reactionStartTime = Date.now();
            const responseMessage = randomItem(CHECKPOINT_RESPONSE_MESSAGES);

            yield* Effect.logInfo("adding checkpoint reactions and response", {
                channel_id: message.channelId,
                message_id: message.id,
                user_id: message.author.id,
                thread_id: thread.id,
                has_wacky_role: hasWackyRole,
                reaction_type: "checkpoint",
            });

            yield* Effect.tryPromise({
                try: () =>
                    Promise.all([
                        message.react("\u{1F389}"),
                        message.react("\u2728"),
                        message.react("\u{1F3C1}"),
                        thread.send(
                            `${responseMessage} \u{1F389} \u2728 \u{1F3C1}`,
                        ),
                    ]),
                catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logInfo("checkpoint reactions and response added successfully", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_id: thread.id,
                        reaction_count: 3,
                        duration_ms: Date.now() - reactionStartTime,
                    })
                ),
                Effect.catchAll((error) =>
                    Effect.logError("checkpoint reactions failed", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_id: thread.id,
                        error_message: error.message,
                        duration_ms: Date.now() - reactionStartTime,
                    })
                ),
            );
        }

        if (message.channelId === SHIP_CHANNEL_ID && hasWackyRole) {
            const reactionStartTime = Date.now();
            const responseMessage = randomItem(SHIP_RESPONSE_MESSAGES);

            yield* Effect.logInfo("adding ship reactions and response", {
                channel_id: message.channelId,
                message_id: message.id,
                user_id: message.author.id,
                thread_id: thread.id,
                has_wacky_role: hasWackyRole,
                reaction_type: "ship",
            });

            yield* Effect.tryPromise({
                try: () =>
                    Promise.all([
                        message.react("\u{1F389}"),
                        message.react("\u2728"),
                        message.react("\u{1F680}"),
                        thread.send(
                            `${responseMessage} \u{1F389} \u2728 \u{1F680}`,
                        ),
                    ]),
                catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logInfo("ship reactions and response added successfully", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_id: thread.id,
                        reaction_count: 3,
                        duration_ms: Date.now() - reactionStartTime,
                    })
                ),
                Effect.catchAll((error) =>
                    Effect.logError("ship reactions failed", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_id: thread.id,
                        error_message: error.message,
                        duration_ms: Date.now() - reactionStartTime,
                    })
                ),
            );
        }

        const archiveStartTime = Date.now();
        yield* Effect.logInfo("archiving thread", {
            channel_id: message.channelId,
            message_id: message.id,
            user_id: message.author.id,
            thread_id: thread.id,
            thread_name: thread.name,
        });

        yield* Effect.tryPromise({
            try: () => thread.setArchived(true),
            catch: (e) => new Error(`Failed to archive: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.tap(() =>
                Effect.logInfo("thread archived successfully auto thread completed", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    user_id: message.author.id,
                    thread_id: thread.id,
                    thread_name: thread.name,
                    is_archived: true,
                    archive_duration_ms: Date.now() - archiveStartTime,
                    total_duration_ms: Date.now() - startTime,
                })
            ),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    yield* Effect.logError("thread archival failed", {
                        channel_id: message.channelId,
                        message_id: message.id,
                        user_id: message.author.id,
                        thread_id: thread.id,
                        thread_name: thread.name,
                        error_message: error.message,
                        archive_duration_ms: Date.now() - archiveStartTime,
                        total_duration_ms: Date.now() - startTime,
                    });
                    return yield* Effect.fail(error);
                })
            ),
        );
    },
    Effect.annotateLogs({ feature: "AutoThread" }),
);
