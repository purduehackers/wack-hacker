import type {
    Message,
    MessageReaction,
    PartialMessageReaction,
    User,
    PartialUser,
    AnyThreadChannel,
} from "discord.js";

import { Effect } from "effect";

import { AppConfig } from "../config";

const structuredError = (e: unknown) => ({
    type:
        typeof e === "object" && e !== null && "_tag" in e
            ? (e as { _tag: string })._tag
            : e instanceof Error
              ? e.constructor.name
              : "Unknown",
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5).join("\n") : undefined,
});

import { handleAutoThread } from "../features/auto-thread";
import {
    handleCommitOverflowReaction,
    handleCommitOverflowThreadCreate,
} from "../features/commit-overflow";
import { handleWackmas } from "../features/commit-overflow";
import { handleDashboardMessage } from "../features/dashboard";
import { handleEvergreenIt } from "../features/evergreen";
import { handleHackNightImages } from "../features/hack-night";
import { handlePraise } from "../features/praise";
import { handleGrokMessage } from "../features/summarize";
import { handleVoiceTranscription } from "../features/voice-transcription";
import { handleWelcomer } from "../features/welcomer";

type MessageHandler = (message: Message) => Effect.Effect<void, unknown, unknown>;
type ReactionHandler = (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) => Effect.Effect<void, unknown, unknown>;
type ThreadCreateHandler = (
    thread: AnyThreadChannel,
    newlyCreated: boolean,
) => Effect.Effect<void, unknown, unknown>;

interface MessageHandlerConfig {
    handler: MessageHandler;
    featureFlag?: keyof ReturnType<typeof getFeatureFlags>;
}

interface ReactionHandlerConfig {
    handler: ReactionHandler;
    featureFlag?: keyof ReturnType<typeof getFeatureFlags>;
}

interface ThreadCreateHandlerConfig {
    handler: ThreadCreateHandler;
    featureFlag?: keyof ReturnType<typeof getFeatureFlags>;
}

const getFeatureFlags = (config: {
    COMMIT_OVERFLOW_ENABLED: boolean;
    DASHBOARD_ENABLED: boolean;
    HACK_NIGHT_PHOTOS_ENABLED: boolean;
    AUTO_THREAD_ENABLED: boolean;
    WELCOMER_ENABLED: boolean;
}) => ({
    commitOverflow: config.COMMIT_OVERFLOW_ENABLED,
    dashboard: config.DASHBOARD_ENABLED,
    hackNightPhotos: config.HACK_NIGHT_PHOTOS_ENABLED,
    autoThread: config.AUTO_THREAD_ENABLED,
    welcomer: config.WELCOMER_ENABLED,
});

const messageHandlers: MessageHandlerConfig[] = [
    { handler: handleGrokMessage },
    { handler: handleHackNightImages, featureFlag: "hackNightPhotos" },
    { handler: handleEvergreenIt },
    { handler: handleAutoThread, featureFlag: "autoThread" },
    { handler: handleWelcomer, featureFlag: "welcomer" },
    { handler: handlePraise },
    { handler: handleVoiceTranscription },
    { handler: handleDashboardMessage, featureFlag: "dashboard" },
    { handler: handleWackmas, featureFlag: "commitOverflow" },
];

const reactionHandlers: ReactionHandlerConfig[] = [
    { handler: handleCommitOverflowReaction, featureFlag: "commitOverflow" },
];

const threadCreateHandlers: ThreadCreateHandlerConfig[] = [
    { handler: handleCommitOverflowThreadCreate, featureFlag: "commitOverflow" },
];

export const handleMessageCreate = Effect.fn("Events.handleMessageCreate")(function* (
    message: Message,
) {
    const startTime = Date.now();

    yield* Effect.annotateCurrentSpan({
        message_id: message.id,
        channel_id: message.channelId,
        author_id: message.author.id,
        author_bot: message.author.bot,
        has_content: message.content.length > 0,
        content_length: message.content.length,
        has_attachments: message.attachments.size > 0,
        attachments_count: message.attachments.size,
    });

    yield* Effect.logDebug("message create event received", {
        event_type: "message_create",
        message_id: message.id,
        channel_id: message.channelId,
        author_id: message.author.id,
        author_bot: message.author.bot,
        content_length: message.content.length,
        attachments_count: message.attachments.size,
    });

    const config = yield* AppConfig;
    const flags = getFeatureFlags(config);

    const allHandlers = messageHandlers;
    const enabledHandlers = messageHandlers.filter((h) => !h.featureFlag || flags[h.featureFlag]);

    yield* Effect.annotateCurrentSpan({
        total_handlers_count: allHandlers.length,
        enabled_handlers_count: enabledHandlers.length,
        disabled_handlers_count: allHandlers.length - enabledHandlers.length,
    });

    yield* Effect.logDebug("message handlers filtered", {
        event_type: "message_create",
        message_id: message.id,
        total_handlers_count: allHandlers.length,
        enabled_handlers_count: enabledHandlers.length,
        disabled_handlers_count: allHandlers.length - enabledHandlers.length,
    });

    const effects = enabledHandlers.map((h) => {
        const handlerStartTime = Date.now();
        return h.handler(message).pipe(
            Effect.tap(() => {
                const handlerDurationMs = Date.now() - handlerStartTime;
                return Effect.logDebug("message handler completed", {
                    event_type: "message_create",
                    message_id: message.id,
                    channel_id: message.channelId,
                    handler_name: h.handler.name,
                    handler_duration_ms: handlerDurationMs,
                });
            }),
            Effect.catchAll((e) => {
                const handlerDurationMs = Date.now() - handlerStartTime;
                return Effect.logError("message handler failed", {
                    event_type: "message_create",
                    error_type: structuredError(e).type,
                    error_message: structuredError(e).message,
                    error_stack: structuredError(e).stack,
                    message_id: message.id,
                    channel_id: message.channelId,
                    author_id: message.author.id,
                    handler_name: h.handler.name,
                    handler_duration_ms: handlerDurationMs,
                });
            }),
        );
    });

    yield* Effect.all(effects, { concurrency: "unbounded", mode: "either" });

    const totalDurationMs = Date.now() - startTime;

    yield* Effect.annotateCurrentSpan({
        total_duration_ms: totalDurationMs,
    });

    yield* Effect.logInfo("message create event processed", {
        event_type: "message_create",
        message_id: message.id,
        channel_id: message.channelId,
        author_id: message.author.id,
        handlers_executed_count: enabledHandlers.length,
        total_duration_ms: totalDurationMs,
    });
});

export const handleMessageReactionAdd = Effect.fn("Events.handleMessageReactionAdd")(function* (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) {
    const startTime = Date.now();
    const emojiName = reaction.emoji.name ?? "unknown";
    const emojiId = reaction.emoji.id ?? "none";

    yield* Effect.annotateCurrentSpan({
        message_id: reaction.message.id,
        channel_id: reaction.message.channelId,
        user_id: user.id,
        user_bot: user.bot ?? false,
        emoji_name: emojiName,
        emoji_id: emojiId,
        emoji_animated: reaction.emoji.animated ?? false,
        reaction_count: reaction.count ?? 0,
    });

    yield* Effect.logDebug("reaction add event received", {
        event_type: "reaction_add",
        message_id: reaction.message.id,
        channel_id: reaction.message.channelId,
        user_id: user.id,
        user_bot: user.bot ?? false,
        emoji_name: emojiName,
        emoji_id: emojiId,
        reaction_count: reaction.count ?? 0,
    });

    const config = yield* AppConfig;
    const flags = getFeatureFlags(config);

    const allHandlers = reactionHandlers;
    const enabledHandlers = reactionHandlers.filter((h) => !h.featureFlag || flags[h.featureFlag]);

    yield* Effect.annotateCurrentSpan({
        total_handlers_count: allHandlers.length,
        enabled_handlers_count: enabledHandlers.length,
        disabled_handlers_count: allHandlers.length - enabledHandlers.length,
    });

    yield* Effect.logDebug("reaction handlers filtered", {
        event_type: "reaction_add",
        message_id: reaction.message.id,
        total_handlers_count: allHandlers.length,
        enabled_handlers_count: enabledHandlers.length,
        disabled_handlers_count: allHandlers.length - enabledHandlers.length,
    });

    const effects = enabledHandlers.map((h) => {
        const handlerStartTime = Date.now();
        return h.handler(reaction, user).pipe(
            Effect.tap(() => {
                const handlerDurationMs = Date.now() - handlerStartTime;
                return Effect.logDebug("reaction handler completed", {
                    event_type: "reaction_add",
                    message_id: reaction.message.id,
                    channel_id: reaction.message.channelId,
                    emoji_name: emojiName,
                    handler_name: h.handler.name,
                    handler_duration_ms: handlerDurationMs,
                });
            }),
            Effect.catchAll((e) => {
                const handlerDurationMs = Date.now() - handlerStartTime;
                return Effect.logError("reaction handler failed", {
                    event_type: "reaction_add",
                    error_type: structuredError(e).type,
                    error_message: structuredError(e).message,
                    error_stack: structuredError(e).stack,
                    message_id: reaction.message.id,
                    channel_id: reaction.message.channelId,
                    user_id: user.id,
                    emoji_name: emojiName,
                    handler_name: h.handler.name,
                    handler_duration_ms: handlerDurationMs,
                });
            }),
        );
    });

    yield* Effect.all(effects, { concurrency: "unbounded", mode: "either" });

    const totalDurationMs = Date.now() - startTime;

    yield* Effect.annotateCurrentSpan({
        total_duration_ms: totalDurationMs,
    });

    yield* Effect.logInfo("reaction add event processed", {
        event_type: "reaction_add",
        message_id: reaction.message.id,
        channel_id: reaction.message.channelId,
        user_id: user.id,
        emoji_name: emojiName,
        handlers_executed_count: enabledHandlers.length,
        total_duration_ms: totalDurationMs,
    });
});

export const handleThreadCreate = Effect.fn("Events.handleThreadCreate")(function* (
    thread: AnyThreadChannel,
    newlyCreated: boolean,
) {
    const startTime = Date.now();

    yield* Effect.annotateCurrentSpan({
        thread_id: thread.id,
        thread_name: thread.name,
        parent_id: thread.parentId,
        owner_id: thread.ownerId,
        newly_created: newlyCreated,
    });

    yield* Effect.logDebug("thread create event received", {
        event_type: "thread_create",
        thread_id: thread.id,
        thread_name: thread.name,
        parent_id: thread.parentId,
        owner_id: thread.ownerId,
        newly_created: newlyCreated,
    });

    const config = yield* AppConfig;
    const flags = getFeatureFlags(config);

    const allHandlers = threadCreateHandlers;
    const enabledHandlers = threadCreateHandlers.filter(
        (h) => !h.featureFlag || flags[h.featureFlag],
    );

    yield* Effect.annotateCurrentSpan({
        total_handlers_count: allHandlers.length,
        enabled_handlers_count: enabledHandlers.length,
        disabled_handlers_count: allHandlers.length - enabledHandlers.length,
    });

    yield* Effect.logDebug("thread create handlers filtered", {
        event_type: "thread_create",
        thread_id: thread.id,
        total_handlers_count: allHandlers.length,
        enabled_handlers_count: enabledHandlers.length,
        disabled_handlers_count: allHandlers.length - enabledHandlers.length,
    });

    const effects = enabledHandlers.map((h) => {
        const handlerStartTime = Date.now();
        return h.handler(thread, newlyCreated).pipe(
            Effect.tap(() => {
                const handlerDurationMs = Date.now() - handlerStartTime;
                return Effect.logDebug("thread create handler completed", {
                    event_type: "thread_create",
                    thread_id: thread.id,
                    thread_name: thread.name,
                    handler_name: h.handler.name,
                    handler_duration_ms: handlerDurationMs,
                });
            }),
            Effect.catchAll((e) => {
                const handlerDurationMs = Date.now() - handlerStartTime;
                return Effect.logError("thread create handler failed", {
                    event_type: "thread_create",
                    error_type: structuredError(e).type,
                    error_message: structuredError(e).message,
                    error_stack: structuredError(e).stack,
                    thread_id: thread.id,
                    thread_name: thread.name,
                    owner_id: thread.ownerId,
                    handler_name: h.handler.name,
                    handler_duration_ms: handlerDurationMs,
                });
            }),
        );
    });

    yield* Effect.all(effects, { concurrency: "unbounded", mode: "either" });

    const totalDurationMs = Date.now() - startTime;

    yield* Effect.annotateCurrentSpan({
        total_duration_ms: totalDurationMs,
    });

    yield* Effect.logInfo("thread create event processed", {
        event_type: "thread_create",
        thread_id: thread.id,
        thread_name: thread.name,
        owner_id: thread.ownerId,
        handlers_executed_count: enabledHandlers.length,
        total_duration_ms: totalDurationMs,
    });
});
