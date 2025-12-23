import {
    SlashCommandBuilder,
    TextChannel,
    MessageFlags,
    type ChatInputCommandInteraction,
    type Message,
    type PublicThreadChannel,
} from "discord.js";
import { Effect } from "effect";
import { distance } from "fastest-levenshtein";

import { dateToSnowflake, formatRelative, parseInterval } from "../../lib/dates";
import { chunkMessage } from "../../lib/discord";
import { AI } from "../../services";
import { SUMMARIZE_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

const ASSISTANT_TRIGGER = "grok";
const SUMMARIZE_TRIGGER = "summary";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export const summarizeCommand = new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize a specific topic from previously sent messages")
    .addStringOption((option) =>
        option
            .setName("topic")
            .setDescription("The topic to summarize (e.g. breakdancing)")
            .setRequired(true),
    )
    .addStringOption((option) =>
        option
            .setName("timeframe")
            .setDescription("The timeframe of past messages to consider (e.g. 1 hour, 30 mins)")
            .setRequired(false),
    );

const summarizeCore = Effect.fn("Summarize.core")(function* (
    channel: TextChannel,
    timeframe: string | null,
    topic: string | null,
) {
    const startTime = Date.now();
    const ai = yield* AI;

    yield* Effect.annotateCurrentSpan({
        channel_id: channel.id,
        timeframe: timeframe ?? "1 hour",
        topic: topic ?? "auto",
    });

    yield* Effect.logDebug("summarize operation started", {
        channel_id: channel.id,
        channel_name: channel.name,
        timeframe: timeframe ?? "1 hour",
        topic: topic ?? "auto",
    });

    const timeframeMs = yield* parseInterval(timeframe ?? "1 hour");

    if (!timeframeMs) {
        yield* Effect.logError("invalid timeframe provided", {
            channel_id: channel.id,
            timeframe: timeframe ?? "1 hour",
            duration_ms: Date.now() - startTime,
        });
        return yield* Effect.fail(new Error("Invalid timeframe provided"));
    }

    const resolvedTopic = topic || "whatever the most common theme of the previous messages is";
    const displayTopic = topic || "WHATEVER";

    const date = new Date(Date.now() - timeframeMs);
    const formatted = yield* formatRelative(date);
    const snowflake = yield* dateToSnowflake(date);

    yield* Effect.logDebug("timeframe parsed", {
        channel_id: channel.id,
        timeframe_ms: timeframeMs,
        start_date: date.toISOString(),
        snowflake,
    });

    const fetchStart = Date.now();
    const messages = yield* Effect.tryPromise({
        try: () => channel.messages.fetch({ limit: 100, after: snowflake }),
        catch: (e) =>
            new Error(`Failed to fetch messages: ${e instanceof Error ? e.message : String(e)}`),
    });
    const fetchDuration = Date.now() - fetchStart;

    const messageCount = messages.size;
    yield* Effect.annotateCurrentSpan({
        message_count: messageCount,
        fetch_duration_ms: fetchDuration,
    });

    yield* Effect.logInfo("messages fetched", {
        channel_id: channel.id,
        message_count: messageCount,
        fetch_duration_ms: fetchDuration,
        snowflake,
    });

    const corpus = messages
        .reverse()
        .map(
            (message) =>
                `[${message.author.displayName} ${new Date(message.createdTimestamp).toISOString()}] ${message.content}`,
        )
        .join("\n");

    const corpusLength = corpus.length;
    const userPrompt = buildUserPrompt(formatted, date.toISOString(), resolvedTopic, corpus);
    const promptLength = userPrompt.length + SUMMARIZE_SYSTEM_PROMPT.length;

    yield* Effect.logDebug("prompt constructed", {
        channel_id: channel.id,
        corpus_length: corpusLength,
        prompt_length: promptLength,
        topic: resolvedTopic,
    });

    const aiStart = Date.now();
    const content = yield* ai.chat({
        model: DEFAULT_MODEL,
        systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
        userPrompt,
    });
    const aiDuration = Date.now() - aiStart;

    const summaryLength = content.length;
    yield* Effect.annotateCurrentSpan({
        ai_model: DEFAULT_MODEL,
        ai_latency_ms: aiDuration,
        summary_length: summaryLength,
    });

    yield* Effect.logInfo("ai summary generated", {
        channel_id: channel.id,
        ai_model: DEFAULT_MODEL,
        ai_latency_ms: aiDuration,
        summary_length: summaryLength,
        message_count: messageCount,
        topic: displayTopic,
    });

    const threadStart = Date.now();
    const thread = yield* Effect.tryPromise({
        try: () =>
            channel.threads.create({
                name: `Summary of ${displayTopic} from ${formatted}`,
                autoArchiveDuration: 60,
                reason: `Summarizing messages related to ${displayTopic} from ${formatted}.`,
            }) as Promise<PublicThreadChannel<false>>,
        catch: (e) =>
            new Error(`Failed to create thread: ${e instanceof Error ? e.message : String(e)}`),
    });
    const threadDuration = Date.now() - threadStart;

    yield* Effect.logDebug("thread created", {
        channel_id: channel.id,
        thread_id: thread.id,
        thread_name: thread.name,
        thread_creation_ms: threadDuration,
    });

    const chunks = yield* chunkMessage(content);
    const chunkCount = chunks.length;

    yield* Effect.logDebug("message chunked", {
        channel_id: channel.id,
        thread_id: thread.id,
        chunk_count: chunkCount,
        summary_length: summaryLength,
    });

    const sendStart = Date.now();
    for (const chunk of chunks) {
        yield* Effect.tryPromise({
            try: () => thread.send(chunk),
            catch: (e) =>
                new Error(`Failed to send message: ${e instanceof Error ? e.message : String(e)}`),
        });
    }
    const sendDuration = Date.now() - sendStart;

    const totalDuration = Date.now() - startTime;

    yield* Effect.logInfo("summary complete", {
        channel_id: channel.id,
        thread_id: thread.id,
        topic: displayTopic,
        message_count: messageCount,
        summary_length: summaryLength,
        chunk_count: chunkCount,
        ai_model: DEFAULT_MODEL,
        duration_ms: totalDuration,
        fetch_duration_ms: fetchDuration,
        ai_latency_ms: aiDuration,
        thread_creation_ms: threadDuration,
        send_duration_ms: sendDuration,
        timeframe: formatted,
    });

    return { thread, topic: displayTopic, formatted };
});

export const handleSummarizeCommand = Effect.fn("Summarize.handleCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const startTime = Date.now();
        const topic = interaction.options.getString("topic");
        const timeframe = interaction.options.getString("timeframe");

        yield* Effect.annotateCurrentSpan({
            user_id: interaction.user.id,
            channel_id: interaction.channelId,
            topic: topic ?? "none",
            timeframe: timeframe ?? "1 hour",
        });

        yield* Effect.logInfo("summarize command invoked", {
            user_id: interaction.user.id,
            username: interaction.user.username,
            channel_id: interaction.channelId,
            guild_id: interaction.guildId ?? "unknown",
            topic: topic ?? "none",
            timeframe: timeframe ?? "1 hour",
        });

        if (!topic) {
            yield* Effect.logWarning("summarize command missing topic", {
                user_id: interaction.user.id,
                channel_id: interaction.channelId,
                duration_ms: Date.now() - startTime,
            });
            yield* Effect.tryPromise({
                try: () => interaction.reply("Please provide a topic to summarize"),
                catch: (e) =>
                    new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
            });
            return;
        }

        if (!interaction.channel) {
            yield* Effect.logWarning("summarize command used outside channel", {
                user_id: interaction.user.id,
                topic,
                duration_ms: Date.now() - startTime,
            });
            yield* Effect.tryPromise({
                try: () => interaction.reply("This command can only be used in a channel"),
                catch: (e) =>
                    new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
            });
            return;
        }

        yield* Effect.tryPromise({
            try: () =>
                interaction.reply({
                    content: `Summarizing messages related to ${topic} from ${timeframe ?? "1 hour"} ago.`,
                    flags: MessageFlags.Ephemeral,
                }),
            catch: (e) =>
                new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
        });

        yield* summarizeCore(interaction.channel as TextChannel, timeframe, topic);

        const totalDuration = Date.now() - startTime;
        yield* Effect.logInfo("summarize command completed", {
            user_id: interaction.user.id,
            channel_id: interaction.channelId,
            topic,
            timeframe: timeframe ?? "1 hour",
            duration_ms: totalDuration,
        });
    },
    Effect.annotateLogs({ feature: "summarize" }),
);

export const handleGrokMessage = Effect.fn("Summarize.handleGrokMessage")(
    function* (message: Message) {
        const startTime = Date.now();

        if (message.author.bot) return;
        if (message.channel.isDMBased()) return;
        if (!(message.channel instanceof TextChannel)) return;

        yield* Effect.annotateCurrentSpan({
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
        });

        yield* Effect.logDebug("grok message received", {
            user_id: message.author.id,
            username: message.author.username,
            channel_id: message.channelId,
            message_id: message.id,
            message_length: message.content.length,
        });

        const result = message.content.replace(/\s+/g, " ").trim();
        const parts = result.split(" ");

        if (parts.length < 2 || !parts[0].startsWith("@")) {
            yield* Effect.logDebug("message does not match grok pattern", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                parts_count: parts.length,
                starts_with_at: parts[0]?.startsWith("@") ?? false,
                duration_ms: Date.now() - startTime,
            });
            return;
        }

        const [ref, invocation, ...time1] = parts;

        const isThisReal = message.content.match(/is\s+this\s+real/);
        const time = isThisReal ? time1.slice(2) : time1;

        const refs = ref.substring(1);
        if (distance(ASSISTANT_TRIGGER, refs) > 3) {
            yield* Effect.logDebug("assistant trigger not matched", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                ref: refs,
                expected_trigger: ASSISTANT_TRIGGER,
                levenshtein_distance: distance(ASSISTANT_TRIGGER, refs),
                threshold: 3,
                duration_ms: Date.now() - startTime,
            });
            return;
        }

        if (distance(SUMMARIZE_TRIGGER, invocation) > 5 && !isThisReal) {
            yield* Effect.logDebug("summarize trigger not matched", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                invocation,
                expected_trigger: SUMMARIZE_TRIGGER,
                levenshtein_distance: distance(SUMMARIZE_TRIGGER, invocation),
                threshold: 5,
                is_this_real: false,
                duration_ms: Date.now() - startTime,
            });
            return;
        }

        const timeframe = time.length > 0 ? time.join(" ") : null;

        yield* Effect.logInfo("grok message matched, starting summarize", {
            user_id: message.author.id,
            username: message.author.username,
            channel_id: message.channelId,
            message_id: message.id,
            timeframe: timeframe ?? "1 hour",
            is_this_real: isThisReal !== null,
        });

        yield* summarizeCore(message.channel as TextChannel, timeframe, null);

        const totalDuration = Date.now() - startTime;
        yield* Effect.logInfo("grok message processing completed", {
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            timeframe: timeframe ?? "1 hour",
            duration_ms: totalDuration,
        });
    },
    Effect.annotateLogs({ feature: "summarize" }),
);
