import { MessageFlags, type Message } from "discord.js";
import { Effect } from "effect";

import { CORE_COMMUNITY_CHANNEL_ID, INTRO_CHANNEL_ID, WELCOMERS_ROLE_ID } from "../../constants";

export const handleWelcomer = Effect.fn("Welcomer.handle")(
    function* (message: Message) {
        const startTime = Date.now();

        const userId = message.author.id;
        const messageId = message.id;
        const guildId = message.guildId;
        const channelId = message.channelId;
        const memberCount = message.guild?.memberCount;
        const accountCreatedAt = message.author.createdAt;
        const accountAgeDays = Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24));

        yield* Effect.annotateCurrentSpan({
            user_id: userId,
            message_id: messageId,
            guild_id: guildId,
            channel_id: channelId,
            member_count: memberCount,
            account_age_days: accountAgeDays,
        });

        if (message.author.bot) {
            yield* Effect.logDebug("message skipped bot author", {
                user_id: userId,
                message_id: messageId,
                reason: "bot_author",
            });
            return;
        }

        if (message.channelId !== INTRO_CHANNEL_ID) {
            yield* Effect.logDebug("message skipped wrong channel", {
                user_id: userId,
                message_id: messageId,
                channel_id: channelId,
                expected_channel_id: INTRO_CHANNEL_ID,
                reason: "wrong_channel",
            });
            return;
        }

        if (message.channel.isDMBased()) {
            yield* Effect.logDebug("message skipped dm channel", {
                user_id: userId,
                message_id: messageId,
                reason: "dm_based",
            });
            return;
        }

        if (message.channel.isThread()) {
            yield* Effect.logDebug("message skipped thread channel", {
                user_id: userId,
                message_id: messageId,
                reason: "is_thread",
            });
            return;
        }

        if (message.system) {
            yield* Effect.logDebug("message skipped system message", {
                user_id: userId,
                message_id: messageId,
                reason: "system_message",
            });
            return;
        }

        if (message.flags.has(MessageFlags.HasThread)) {
            yield* Effect.logDebug("message skipped has thread", {
                user_id: userId,
                message_id: messageId,
                reason: "has_thread",
            });
            return;
        }

        yield* Effect.logInfo("processing welcomer message", {
            user_id: userId,
            message_id: messageId,
            guild_id: guildId,
            channel_id: channelId,
            member_count: memberCount,
            account_age_days: accountAgeDays,
            username: message.author.username,
        });

        const channelFetchStart = Date.now();
        const channel = yield* Effect.tryPromise({
            try: () => message.client.channels.fetch(CORE_COMMUNITY_CHANNEL_ID),
            catch: (e) => new Error(`Failed to fetch channel: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.tap(() =>
                Effect.gen(function* () {
                    const channelFetchDuration = Date.now() - channelFetchStart;
                    yield* Effect.annotateCurrentSpan({ channel_fetch_duration_ms: channelFetchDuration });
                    yield* Effect.logDebug("welcome channel fetched", {
                        user_id: userId,
                        message_id: messageId,
                        welcome_channel_id: CORE_COMMUNITY_CHANNEL_ID,
                        duration_ms: channelFetchDuration,
                    });
                }),
            ),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    const channelFetchDuration = Date.now() - channelFetchStart;
                    yield* Effect.annotateCurrentSpan({
                        channel_fetch_duration_ms: channelFetchDuration,
                        channel_fetch_error: error.message,
                    });
                    yield* Effect.logError("welcome channel fetch failed", {
                        user_id: userId,
                        message_id: messageId,
                        welcome_channel_id: CORE_COMMUNITY_CHANNEL_ID,
                        duration_ms: channelFetchDuration,
                        error: error.message,
                    });
                    return yield* Effect.fail(error);
                }),
            ),
        );

        if (!channel || !channel.isSendable()) {
            const totalDuration = Date.now() - startTime;
            yield* Effect.annotateCurrentSpan({
                total_duration_ms: totalDuration,
                channel_not_sendable: true,
            });
            yield* Effect.logWarning("welcome channel not sendable", {
                user_id: userId,
                message_id: messageId,
                welcome_channel_id: CORE_COMMUNITY_CHANNEL_ID,
                channel_exists: !!channel,
                channel_sendable: channel?.isSendable() ?? false,
                duration_ms: totalDuration,
            });
            return;
        }

        const messageSendStart = Date.now();
        yield* Effect.tryPromise({
            try: async () => {
                await channel.send(
                    `Hey <@&${WELCOMERS_ROLE_ID}>, somebody just introduced themselves!! Give them a warm welcome :D\n\n${message.channel.url}`,
                );
            },
            catch: (e) => new Error(`Failed to send: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.tap(() =>
                Effect.gen(function* () {
                    const messageSendDuration = Date.now() - messageSendStart;
                    const totalDuration = Date.now() - startTime;
                    yield* Effect.annotateCurrentSpan({
                        message_send_duration_ms: messageSendDuration,
                        total_duration_ms: totalDuration,
                    });
                    yield* Effect.logInfo("member welcomed", {
                        user_id: userId,
                        message_id: messageId,
                        guild_id: guildId,
                        welcome_channel_id: CORE_COMMUNITY_CHANNEL_ID,
                        intro_channel_id: INTRO_CHANNEL_ID,
                        member_count: memberCount,
                        account_age_days: accountAgeDays,
                        username: message.author.username,
                        message_send_duration_ms: messageSendDuration,
                        duration_ms: totalDuration,
                    });
                }),
            ),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    const messageSendDuration = Date.now() - messageSendStart;
                    const totalDuration = Date.now() - startTime;
                    yield* Effect.annotateCurrentSpan({
                        message_send_duration_ms: messageSendDuration,
                        total_duration_ms: totalDuration,
                        message_send_error: error.message,
                    });
                    yield* Effect.logError("welcome message send failed", {
                        user_id: userId,
                        message_id: messageId,
                        guild_id: guildId,
                        welcome_channel_id: CORE_COMMUNITY_CHANNEL_ID,
                        member_count: memberCount,
                        account_age_days: accountAgeDays,
                        message_send_duration_ms: messageSendDuration,
                        duration_ms: totalDuration,
                        error: error.message,
                    });
                    return yield* Effect.fail(error);
                }),
            ),
        );
    },
    Effect.annotateLogs({ feature: "welcomer" }),
);
