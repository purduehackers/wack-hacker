import type { Message, ChatInputCommandInteraction, TextChannel, ThreadChannel } from "discord.js";

import { MessageFlags } from "discord.js";
import { Effect } from "effect";

import { DiscordReplyError, DiscordSendError, EmptyArrayError } from "../errors";

const MAX_MESSAGE_LENGTH = 2000;

export const chunkMessage = Effect.fn("chunkMessage")(function* (content: string) {
    const startMs = Date.now();

    if (content.length <= MAX_MESSAGE_LENGTH) {
        const durationMs = Date.now() - startMs;
        yield* Effect.logDebug("message within length limit, no chunking needed", {
            operation: "chunk_message",
            content_length: content.length,
            max_length: MAX_MESSAGE_LENGTH,
            chunks_created: 1,
            requires_chunking: false,
            duration_ms: durationMs,
        });
        return [content];
    }

    const chunks: string[] = [];
    let remaining = content;
    let iterationCount = 0;

    while (remaining.length > 0) {
        iterationCount++;

        if (remaining.length <= MAX_MESSAGE_LENGTH) {
            chunks.push(remaining);
            break;
        }

        let breakPoint = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);

        if (breakPoint === -1 || breakPoint < MAX_MESSAGE_LENGTH / 2) {
            breakPoint = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);
        }

        if (breakPoint === -1 || breakPoint < MAX_MESSAGE_LENGTH / 2) {
            breakPoint = MAX_MESSAGE_LENGTH;
        }

        chunks.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trimStart();
    }

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("chunked message into multiple parts", {
        operation: "chunk_message",
        content_length: content.length,
        max_length: MAX_MESSAGE_LENGTH,
        chunks_created: chunks.length,
        requires_chunking: true,
        iterations: iterationCount,
        average_chunk_size: Math.floor(content.length / chunks.length),
        duration_ms: durationMs,
    });

    return chunks;
});

export const sendChunkedMessage = Effect.fn("sendChunkedMessage")(function* (
    channel: TextChannel | ThreadChannel,
    content: string,
) {
    const startMs = Date.now();
    const channelId = channel.id;
    const channelType = channel.type;

    const chunks = yield* chunkMessage(content);

    const result = yield* Effect.tryPromise({
        try: async () => {
            const messages: Message[] = [];

            for (const chunk of chunks) {
                const msg = await channel.send(chunk);
                messages.push(msg);
            }

            return messages;
        },
        catch: (cause) => new DiscordSendError({ channelId: channel.id, cause }),
    });

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("sent chunked message to discord channel", {
        operation: "send_chunked_message",
        channel_id: channelId,
        channel_type: channelType,
        content_length: content.length,
        chunks_sent: chunks.length,
        messages_created: result.length,
        duration_ms: durationMs,
    });

    return result;
});

export const replyEphemeral = Effect.fn("replyEphemeral")(function* (
    interaction: ChatInputCommandInteraction,
    content: string,
) {
    const startMs = Date.now();
    const interactionId = interaction.id;
    const userId = interaction.user.id;
    const commandName = interaction.commandName;

    yield* Effect.tryPromise({
        try: () =>
            interaction.reply({
                content,
                flags: MessageFlags.Ephemeral,
            }),
        catch: (cause) => new DiscordReplyError({ messageId: interaction.id, cause }),
    });

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("sent ephemeral reply to interaction", {
        operation: "reply_ephemeral",
        interaction_id: interactionId,
        user_id: userId,
        command_name: commandName,
        content_length: content.length,
        is_ephemeral: true,
        duration_ms: durationMs,
    });
});

export const followUpEphemeral = Effect.fn("followUpEphemeral")(function* (
    interaction: ChatInputCommandInteraction,
    content: string,
) {
    const startMs = Date.now();
    const interactionId = interaction.id;
    const userId = interaction.user.id;
    const commandName = interaction.commandName;

    yield* Effect.tryPromise({
        try: () =>
            interaction.followUp({
                content,
                flags: MessageFlags.Ephemeral,
            }),
        catch: (cause) => new DiscordReplyError({ messageId: interaction.id, cause }),
    });

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("sent ephemeral follow-up to interaction", {
        operation: "follow_up_ephemeral",
        interaction_id: interactionId,
        user_id: userId,
        command_name: commandName,
        content_length: content.length,
        is_ephemeral: true,
        duration_ms: durationMs,
    });
});

export const safeReply = Effect.fn("safeReply")(function* (
    interaction: ChatInputCommandInteraction,
    content: string,
    ephemeral = false,
) {
    const startMs = Date.now();
    const interactionId = interaction.id;
    const userId = interaction.user.id;
    const commandName = interaction.commandName;
    const wasReplied = interaction.replied;
    const wasDeferred = interaction.deferred;
    const usedFollowUp = wasReplied || wasDeferred;

    yield* Effect.tryPromise({
        try: async () => {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content,
                    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
                });
            } else {
                await interaction.reply({
                    content,
                    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
                });
            }
        },
        catch: (cause) => new DiscordReplyError({ messageId: interaction.id, cause }),
    });

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("sent safe reply to interaction", {
        operation: "safe_reply",
        interaction_id: interactionId,
        user_id: userId,
        command_name: commandName,
        content_length: content.length,
        is_ephemeral: ephemeral,
        was_replied: wasReplied,
        was_deferred: wasDeferred,
        used_follow_up: usedFollowUp,
        reply_method: usedFollowUp ? "followUp" : "reply",
        duration_ms: durationMs,
    });
});

export const safeDeleteMessage = Effect.fn("safeDeleteMessage")(function* (message: Message) {
    const startMs = Date.now();
    const messageId = message.id;
    const channelId = message.channelId;
    const authorId = message.author.id;

    const deleteResult = yield* Effect.tryPromise({
        try: () => message.delete(),
        catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    const durationMs = Date.now() - startMs;

    yield* Effect.logDebug("attempted to delete message safely", {
        operation: "safe_delete_message",
        message_id: messageId,
        channel_id: channelId,
        author_id: authorId,
        delete_succeeded: deleteResult !== undefined,
        duration_ms: durationMs,
    });
});

export const containsUrl = Effect.fn("containsUrl")(function* (text: string) {
    const startMs = Date.now();
    const urlPattern = /https?:\/\/\S+/i;
    const result = urlPattern.test(text);
    const durationMs = Date.now() - startMs;

    yield* Effect.logDebug("checked text for url presence", {
        operation: "contains_url",
        text_length: text.length,
        contains_url: result,
        pattern_used: "https?:\\/\\/\\S+",
        duration_ms: durationMs,
    });

    return result;
});

export const randomItem = Effect.fn("randomItem")(function* (items: readonly string[]) {
    const startMs = Date.now();

    if (items.length === 0) {
        const durationMs = Date.now() - startMs;
        yield* Effect.logWarning("attempted to select random item from empty array", {
            operation: "random_item",
            items_count: 0,
            duration_ms: durationMs,
        });
        return yield* Effect.fail(new EmptyArrayError({ operation: "random_item" }));
    }

    const randomIndex = Math.floor(Math.random() * items.length);
    const result = items[randomIndex];
    const durationMs = Date.now() - startMs;

    yield* Effect.logDebug("selected random item from array", {
        operation: "random_item",
        items_count: items.length,
        selected_index: randomIndex,
        duration_ms: durationMs,
    });

    return result;
});
