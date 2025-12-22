import { ChannelType, type Message } from "discord.js";
import { Effect } from "effect";

import { WACKY_ROLE_ID } from "../../constants";

const ENABLE_PATTERN = /wackity\s+hackity\s+praise\s+me/;
const DISABLE_PATTERN = /wackity\s+hackity\s+go\s+away/;

export const handlePraise = Effect.fn("Praise.handle")(
    function* (message: Message) {
        const startTime = Date.now();

        if (message.author.bot) {
            yield* Effect.logDebug("praise message ignored", {
                user_id: message.author.id,
                message_id: message.id,
                channel_id: message.channelId,
                reason: "bot_author",
            });
            return;
        }

        if (
            !(
                message.channel.type === ChannelType.GuildText ||
                message.channel.type === ChannelType.PublicThread
            )
        ) {
            yield* Effect.logDebug("praise message ignored", {
                user_id: message.author.id,
                message_id: message.id,
                channel_id: message.channelId,
                channel_type: message.channel.type,
                reason: "invalid_channel_type",
            });
            return;
        }

        if (message.member === null) {
            yield* Effect.logDebug("praise message ignored", {
                user_id: message.author.id,
                message_id: message.id,
                channel_id: message.channelId,
                reason: "no_member_object",
            });
            return;
        }

        yield* Effect.annotateCurrentSpan({
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            guild_id: message.guildId || "unknown",
            username: message.author.username,
        });

        const enableMatch = message.content.match(ENABLE_PATTERN);
        const disableMatch = message.content.match(DISABLE_PATTERN);

        if (enableMatch) {
            yield* Effect.logInfo("praise enable initiated", {
                user_id: message.author.id,
                username: message.author.username,
                message_id: message.id,
                channel_id: message.channelId,
                guild_id: message.guildId || "unknown",
                role_id: WACKY_ROLE_ID,
                action: "enable_praise",
            });

            const roleAddStart = Date.now();
            yield* Effect.tryPromise({
                try: () => message.member!.roles.add(WACKY_ROLE_ID),
                catch: (e) => new Error(`Failed to add role: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logInfo("praise role added", {
                        user_id: message.author.id,
                        username: message.author.username,
                        message_id: message.id,
                        channel_id: message.channelId,
                        guild_id: message.guildId || "unknown",
                        role_id: WACKY_ROLE_ID,
                        duration_ms: Date.now() - roleAddStart,
                        action: "role_added",
                    }),
                ),
                Effect.tapError((error) =>
                    Effect.logError("praise role add failed", {
                        user_id: message.author.id,
                        username: message.author.username,
                        message_id: message.id,
                        channel_id: message.channelId,
                        guild_id: message.guildId || "unknown",
                        role_id: WACKY_ROLE_ID,
                        duration_ms: Date.now() - roleAddStart,
                        error_message: error.message,
                        action: "role_add_failed",
                    }),
                ),
            );

            const reactionStart = Date.now();
            yield* Effect.tryPromise({
                try: () => message.react("\u{1F973}"),
                catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logDebug("praise reaction added", {
                        user_id: message.author.id,
                        message_id: message.id,
                        channel_id: message.channelId,
                        reaction: "🥳",
                        duration_ms: Date.now() - reactionStart,
                        action: "reaction_added",
                    }),
                ),
                Effect.tapError((error) =>
                    Effect.logWarning("praise reaction failed", {
                        user_id: message.author.id,
                        message_id: message.id,
                        channel_id: message.channelId,
                        reaction: "🥳",
                        duration_ms: Date.now() - reactionStart,
                        error_message: error.message,
                        action: "reaction_failed",
                    }),
                ),
            );

            yield* Effect.logInfo("praise enabled", {
                user_id: message.author.id,
                username: message.author.username,
                message_id: message.id,
                channel_id: message.channelId,
                guild_id: message.guildId || "unknown",
                role_id: WACKY_ROLE_ID,
                duration_ms: Date.now() - startTime,
                action: "praise_enabled",
                status: "success",
            });
        } else if (disableMatch) {
            yield* Effect.logInfo("praise disable initiated", {
                user_id: message.author.id,
                username: message.author.username,
                message_id: message.id,
                channel_id: message.channelId,
                guild_id: message.guildId || "unknown",
                role_id: WACKY_ROLE_ID,
                action: "disable_praise",
            });

            const roleRemoveStart = Date.now();
            yield* Effect.tryPromise({
                try: () => message.member!.roles.remove(WACKY_ROLE_ID),
                catch: (e) => new Error(`Failed to remove role: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logInfo("praise role removed", {
                        user_id: message.author.id,
                        username: message.author.username,
                        message_id: message.id,
                        channel_id: message.channelId,
                        guild_id: message.guildId || "unknown",
                        role_id: WACKY_ROLE_ID,
                        duration_ms: Date.now() - roleRemoveStart,
                        action: "role_removed",
                    }),
                ),
                Effect.tapError((error) =>
                    Effect.logError("praise role remove failed", {
                        user_id: message.author.id,
                        username: message.author.username,
                        message_id: message.id,
                        channel_id: message.channelId,
                        guild_id: message.guildId || "unknown",
                        role_id: WACKY_ROLE_ID,
                        duration_ms: Date.now() - roleRemoveStart,
                        error_message: error.message,
                        action: "role_remove_failed",
                    }),
                ),
            );

            const reactionStart = Date.now();
            yield* Effect.tryPromise({
                try: () => message.react("\u{1F910}"),
                catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(
                Effect.tap(() =>
                    Effect.logDebug("praise reaction added", {
                        user_id: message.author.id,
                        message_id: message.id,
                        channel_id: message.channelId,
                        reaction: "🤐",
                        duration_ms: Date.now() - reactionStart,
                        action: "reaction_added",
                    }),
                ),
                Effect.tapError((error) =>
                    Effect.logWarning("praise reaction failed", {
                        user_id: message.author.id,
                        message_id: message.id,
                        channel_id: message.channelId,
                        reaction: "🤐",
                        duration_ms: Date.now() - reactionStart,
                        error_message: error.message,
                        action: "reaction_failed",
                    }),
                ),
            );

            yield* Effect.logInfo("praise disabled", {
                user_id: message.author.id,
                username: message.author.username,
                message_id: message.id,
                channel_id: message.channelId,
                guild_id: message.guildId || "unknown",
                role_id: WACKY_ROLE_ID,
                duration_ms: Date.now() - startTime,
                action: "praise_disabled",
                status: "success",
            });
        }
    },
    Effect.annotateLogs({ feature: "praise" }),
);
