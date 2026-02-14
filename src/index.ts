import { Events, MessageFlags } from "discord.js";
import { Cause, Effect, Exit, Layer, Logger, ManagedRuntime } from "effect";

import { AppConfig } from "./config";
import { type DiscordError, structuredError } from "./errors";
import {
    getEnabledCommands,
    findCommand,
    handleMessageCreate,
    handleMessageDelete,
    handleMessageReactionAdd,
    handleMessageReactionRemove,
    handleThreadCreate,
    startCronJobs,
} from "./runtime";
import { handleMeetingVoiceStateUpdate } from "./features/meeting-notes";
import { ServicesLive, Discord } from "./services";

const isDev = process.env.NODE_ENV !== "production";
const requestedHealthPort = Number.parseInt(process.env.PORT ?? "3000", 10);

const AppLayer = Layer.mergeAll(ServicesLive, AppConfig.Default).pipe((layer) =>
    isDev ? Layer.provide(layer, Logger.pretty) : layer,
);

const runtime = ManagedRuntime.make(AppLayer);

type AppEffect<A, E = never> = Effect.Effect<A, E, never>;

const createHealthServer = (): {
    server: ReturnType<typeof Bun.serve> | null;
    startup_error: string | null;
} => {
    const fetch = () =>
        new Response("Wack Hacker is running!", {
            headers: { "content-type": "text/plain" },
        });

    const candidatePorts = Array.from(new Set([requestedHealthPort, requestedHealthPort + 1, 0]));
    let lastError: unknown = null;

    for (const candidatePort of candidatePorts) {
        try {
            return {
                server: Bun.serve({
                    fetch,
                    port: candidatePort,
                }),
                startup_error: null,
            };
        } catch (error) {
            lastError = error;
        }
    }

    return {
        server: null,
        startup_error: lastError instanceof Error ? lastError.message : String(lastError),
    };
};

const healthServerResult = createHealthServer();
const healthServer = healthServerResult.server;

const program = Effect.gen(function* () {
    const startTime = Date.now();
    yield* Effect.logInfo("wack hacker starting", {
        node_env: process.env.NODE_ENV ?? "development",
        service_name: "wack_hacker",
    });

    const discord = yield* Discord;

    yield* discord.login();
    const client = yield* discord.awaitReady();
    const commandClientId = client.application?.id ?? client.user.id;

    const enabledCommands = yield* getEnabledCommands;
    yield* discord.registerCommands(enabledCommands.map((c) => c.data), commandClientId).pipe(
        Effect.catchTag("DiscordError", (error) =>
            Effect.logWarning("discord command registration failed; startup continuing", {
                ...structuredError(error),
                service_name: "wack_hacker",
                client_id: commandClientId,
                command_count: enabledCommands.length,
                reason: "registration_failed_startup_degraded",
            }),
        ),
    );

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
                        ...structuredError(e),
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
                    ...structuredError(e),
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
                    ...structuredError(e),
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
                    ...structuredError(e),
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

    client.on(Events.MessageDelete, async (message) => {
        const deleteStartTime = Date.now();

        if (message.partial) return;

        const deleteProgram = handleMessageDelete(message).pipe(
            Effect.tap(() =>
                Effect.logDebug("message delete handled", {
                    message_id: message.id,
                    channel_id: message.channelId,
                    author_id: message.author?.id,
                    duration_ms: Date.now() - deleteStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.logError("message delete handling failed", {
                    ...structuredError(e),
                    message_id: message.id,
                    channel_id: message.channelId,
                    author_id: message.author?.id,
                    duration_ms: Date.now() - deleteStartTime,
                }),
            ),
        ) as AppEffect<void>;

        void runtime.runPromise(deleteProgram);
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
                    ...structuredError(e),
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

    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        const voiceStateStartTime = Date.now();

        const voiceStateProgram = handleMeetingVoiceStateUpdate(oldState, newState).pipe(
            Effect.tap(() =>
                Effect.logDebug("voice state update handled", {
                    guild_id: newState.guild.id,
                    user_id: newState.id,
                    old_channel_id: oldState.channelId ?? "none",
                    new_channel_id: newState.channelId ?? "none",
                    duration_ms: Date.now() - voiceStateStartTime,
                }),
            ),
            Effect.catchAll((e) =>
                Effect.logError("voice state update handling failed", {
                    ...structuredError(e),
                    guild_id: newState.guild.id,
                    user_id: newState.id,
                    old_channel_id: oldState.channelId ?? "none",
                    new_channel_id: newState.channelId ?? "none",
                    duration_ms: Date.now() - voiceStateStartTime,
                }),
            ),
        ) as AppEffect<void>;

        void runtime.runPromise(voiceStateProgram);
    });

    const startupDuration = Date.now() - startTime;
    yield* Effect.logInfo("wack hacker started", {
        service_name: "wack_hacker",
        node_env: process.env.NODE_ENV ?? "development",
        duration_ms: startupDuration,
        health_server_enabled: healthServer !== null,
        server_port: healthServer?.port ?? null,
        server_requested_port: requestedHealthPort,
        health_server_startup_error: healthServerResult.startup_error,
    });
});

const httpServerLogEffect =
    healthServer === null
        ? Effect.logWarning("http server startup skipped", {
              service_name: "wack_hacker",
              server_requested_port: requestedHealthPort,
              reason: "all_port_bind_attempts_failed",
              startup_error: healthServerResult.startup_error,
          })
        : Effect.logInfo("http server started", {
              service_name: "wack_hacker",
              server_port: healthServer.port,
              server_requested_port: requestedHealthPort,
              server_url: `http://localhost:${healthServer.port}`,
              used_fallback_port: healthServer.port !== requestedHealthPort,
          });

void httpServerLogEffect.pipe(Effect.provide(AppLayer), Effect.runPromise);

const main = program.pipe(Effect.provide(AppLayer)) as AppEffect<void, DiscordError>;

void Effect.runPromiseExit(main).then((exit) => {
    if (Exit.isSuccess(exit)) {
        return;
    }

    const squashedError = Cause.squash(exit.cause);

    void Effect.logError("fatal error during startup", {
        service_name: "wack_hacker",
        ...structuredError(squashedError),
        error_cause_pretty: Cause.pretty(exit.cause),
    })
        .pipe(Effect.provide(AppLayer), Effect.runPromise)
        .finally(() => process.exit(1));
});
