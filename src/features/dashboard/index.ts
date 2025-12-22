import type { Message } from "discord.js";

import { Effect } from "effect";

import { INTERNAL_CATEGORIES } from "../../constants";
import { Dashboard } from "../../services";

export const handleDashboardMessage = Effect.fn("Dashboard.handleMessage")(
    function* (message: Message) {
        const handleStartTime = Date.now();
        const dashboard = yield* Dashboard;

        yield* Effect.annotateCurrentSpan({
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
            username: message.author.username,
            is_bot: message.author.bot,
            is_dm: message.channel.isDMBased(),
        });

        if (message.author.bot) {
            yield* Effect.logDebug("message ignored", {
                reason: "bot_author",
                user_id: message.author.id,
                username: message.author.username,
                channel_id: message.channelId,
                message_id: message.id,
            });
            return;
        }

        if (message.channel.isDMBased()) {
            yield* Effect.logDebug("message ignored", {
                reason: "dm_channel",
                user_id: message.author.id,
                username: message.author.username,
                channel_id: message.channelId,
                message_id: message.id,
            });
            return;
        }

        const parentId = (message.channel as { parentId?: string | null }).parentId;
        if (parentId && (INTERNAL_CATEGORIES as readonly string[]).includes(parentId)) {
            yield* Effect.logDebug("message ignored", {
                reason: "internal_category",
                user_id: message.author.id,
                username: message.author.username,
                channel_id: message.channelId,
                message_id: message.id,
                parent_id: parentId,
            });
            return;
        }

        const messagePayload = {
            image: message.author.avatarURL(),
            timestamp: message.createdAt.toISOString(),
            username: message.author.username,
            content: message.content,
            attachments:
                message.attachments.size > 0
                    ? [...message.attachments.values()].map((a) => a.url)
                    : undefined,
        };

        yield* Effect.logDebug("processing dashboard message", {
            user_id: message.author.id,
            username: message.author.username,
            channel_id: message.channelId,
            message_id: message.id,
            content_length: message.content.length,
            has_avatar: messagePayload.image !== null,
            attachment_count: message.attachments.size,
            has_attachments: message.attachments.size > 0,
        });

        yield* dashboard.send(messagePayload);

        const durationMs = Date.now() - handleStartTime;

        yield* Effect.logInfo("dashboard message handled", {
            user_id: message.author.id,
            username: message.author.username,
            channel_id: message.channelId,
            message_id: message.id,
            content_length: message.content.length,
            attachment_count: message.attachments.size,
            duration_ms: durationMs,
        });
    },
    Effect.annotateLogs({ feature: "dashboard" }),
);
