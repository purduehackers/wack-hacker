import { Events, MessageFlags } from "discord.js";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";

import type { DiscordError } from "./errors";

import { AppConfig } from "./config";
import {
    getEnabledCommands,
    findCommand,
    handleMessageCreate,
    handleMessageReactionAdd,
    handleMessageReactionRemove,
    handleThreadCreate,
    startCronJobs,
} from "./runtime";
import { ServicesLive, Discord } from "./services";

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

const isDev = process.env.NODE_ENV !== "production";

const AppLayer = Layer.mergeAll(ServicesLive, AppConfig.Default).pipe((layer) =>
    isDev ? Layer.provide(layer, Logger.pretty) : layer,
);

const runtime = ManagedRuntime.make(AppLayer);

type AppEffect<A, E = never> = Effect.Effect<A, E, never>;

const program = Effect.gen(function* () {
    const startTime = Date.now();
    yield* Effect.logInfo("wack hacker starting", {
        node_env: process.env.NODE_ENV ?? "development",
        service_name: "wack_hacker",
    });

    const discord = yield* Discord;

    const enabledCommands = yield* getEnabledCommands;
    yield* discord.registerCommands(enabledCommands.map((c) => c.data));

    yield* discord.login();
    const client = yield* discord.awaitReady();

    yield* startCronJobs(client);

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const commandStartTime = Date.now();

        const command = findCommand(interaction.commandName);
        if (!command) {
            void runtime.runPromise(
                Effect.logWarning("command not found", {
                    command_name: interaction.commandName,
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                    guild_id: interaction.guildId ?? "dm",
                }),
            );

            await interaction.reply({
                content: "This command does not exist!",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const commandProgram = command.execute(interaction).pipe(
            Effect.tap(() =>
                Effect.logInfo("command executed successfully", {
                    command_name: interaction.commandName,
                    user_id: interaction.user.id,
                    username: interaction.user.username,
                    channel_id: interaction.channelId,
                    guild_id: interaction.guildId ?? "dm",
                    duration_ms: Date.now() - commandStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.gen(function* () {
                    yield* Effect.logError("command execution failed", {
                        error: structuredError(e),
                        command_name: interaction.commandName,
                        user_id: interaction.user.id,
                        username: interaction.user.username,
                        channel_id: interaction.channelId,
                        guild_id: interaction.guildId ?? "dm",
                        duration_ms: Date.now() - commandStartTime,
                    });
                    yield* Effect.tryPromise({
                        try: async () => {
                            if (interaction.replied || interaction.deferred) {
                                await interaction.followUp({
                                    content: "There was an error while executing this command!",
                                    flags: MessageFlags.Ephemeral,
                                });
                            } else {
                                await interaction.reply({
                                    content: "There was an error while executing this command!",
                                    flags: MessageFlags.Ephemeral,
                                });
                            }
                        },
                        catch: () => undefined,
                    });
                }),
            ),
            Effect.withSpan("runtime.handle_command", {
                attributes: {
                    command_name: interaction.commandName,
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                    guild_id: interaction.guildId ?? "dm",
                },
            }),
        ) as AppEffect<void, undefined>;

        void runtime.runPromise(commandProgram);
    });

    client.on(Events.MessageCreate, async (message) => {
        const messageStartTime = Date.now();

        const messageProgram = handleMessageCreate(message).pipe(
            Effect.tap(() =>
                Effect.logDebug("message handled", {
                    message_id: message.id,
                    channel_id: message.channelId,
                    author_id: message.author.id,
                    author_username: message.author.username,
                    is_bot: message.author.bot,
                    duration_ms: Date.now() - messageStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.logError("message handling failed", {
                    error: structuredError(e),
                    message_id: message.id,
                    channel_id: message.channelId,
                    author_id: message.author.id,
                    author_username: message.author.username,
                    duration_ms: Date.now() - messageStartTime,
                }),
            ),
        ) as AppEffect<void>;

        void runtime.runPromise(messageProgram);
    });

    client.on(Events.MessageReactionAdd, async (reaction, user) => {
        const reactionStartTime = Date.now();

        const reactionProgram = handleMessageReactionAdd(reaction, user).pipe(
            Effect.tap(() =>
                Effect.logDebug("reaction handled", {
                    message_id: reaction.message.id,
                    channel_id: reaction.message.channelId,
                    user_id: user.id,
                    username: user.username,
                    emoji: reaction.emoji.name ?? "unknown",
                    duration_ms: Date.now() - reactionStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.logError("reaction handling failed", {
                    error: structuredError(e),
                    message_id: reaction.message.id,
                    channel_id: reaction.message.channelId,
                    user_id: user.id,
                    username: user.username,
                    emoji: reaction.emoji.name ?? "unknown",
                    duration_ms: Date.now() - reactionStartTime,
                }),
            ),
        ) as AppEffect<void>;

        void runtime.runPromise(reactionProgram);
    });

    client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
        const threadStartTime = Date.now();

        const threadProgram = handleThreadCreate(thread, newlyCreated).pipe(
            Effect.tap(() =>
                Effect.logDebug("thread create handled", {
                    thread_id: thread.id,
                    thread_name: thread.name,
                    parent_id: thread.parentId,
                    owner_id: thread.ownerId,
                    newly_created: newlyCreated,
                    duration_ms: Date.now() - threadStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.logError("thread create handling failed", {
                    error: structuredError(e),
                    thread_id: thread.id,
                    thread_name: thread.name,
                    parent_id: thread.parentId,
                    owner_id: thread.ownerId,
                    newly_created: newlyCreated,
                    duration_ms: Date.now() - threadStartTime,
                }),
            ),
        ) as AppEffect<void>;

        void runtime.runPromise(threadProgram);
    });

    client.on(Events.MessageReactionRemove, async (reaction, user) => {
        const reactionStartTime = Date.now();

        const reactionProgram = handleMessageReactionRemove(reaction, user).pipe(
            Effect.tap(() =>
                Effect.logDebug("reaction remove handled", {
                    message_id: reaction.message.id,
                    channel_id: reaction.message.channelId,
                    user_id: user.id,
                    username: user.username,
                    emoji: reaction.emoji.name ?? "unknown",
                    duration_ms: Date.now() - reactionStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.logError("reaction remove handling failed", {
                    error: structuredError(e),
                    message_id: reaction.message.id,
                    channel_id: reaction.message.channelId,
                    user_id: user.id,
                    username: user.username,
                    emoji: reaction.emoji.name ?? "unknown",
                    duration_ms: Date.now() - reactionStartTime,
                }),
            ),
        ) as AppEffect<void>;

        void runtime.runPromise(reactionProgram);
    });

    const startupDuration = Date.now() - startTime;
    yield* Effect.logInfo("wack hacker started", {
        service_name: "wack_hacker",
        node_env: process.env.NODE_ENV ?? "development",
        duration_ms: startupDuration,
        server_port: 3000,
    });
});

Bun.serve({
    fetch() {
        return new Response("Wack Hacker is running!", {
            headers: { "content-type": "text/plain" },
        });
    },
    port: 3000,
});

void Effect.logInfo("http server started", {
    service_name: "wack_hacker",
    server_port: 3000,
    server_url: `http://localhost:3000`,
}).pipe(Effect.provide(AppLayer), Effect.runPromise);

const main = program.pipe(Effect.provide(AppLayer)) as AppEffect<void, DiscordError>;

Effect.runPromise(main).catch((e) => {
    const error = structuredError(e);
    void Effect.logError("fatal error during startup", {
        service_name: "wack_hacker",
        error_type: error.type,
        error_message: error.message,
        stack_trace: error.stack,
    })
        .pipe(Effect.provide(AppLayer), Effect.runPromise)
        .finally(() => process.exit(1));
});
