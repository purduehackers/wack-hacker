import {
    Client,
    GatewayIntentBits,
    Partials,
    Events,
    ActivityType,
    REST,
    Routes,
} from "discord.js";
import { Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { DiscordError } from "../errors";

export class Discord extends Effect.Service<Discord>()("Discord", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const botToken = Redacted.value(config.DISCORD_BOT_TOKEN);

        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessageReactions,
            ],
            partials: [Partials.Message, Partials.Reaction, Partials.Channel],
        });

        const rest = new REST({ version: "10" }).setToken(botToken);

        const registerCommands = Effect.fn("Discord.registerCommands")(function* (
            commands: { toJSON: () => unknown }[],
            clientId?: string,
        ) {
            const resolvedClientId = clientId ?? config.DISCORD_CLIENT_ID;

            yield* Effect.logDebug("registering discord commands", {
                service_name: "Discord",
                method: "registerCommands",
                operation_type: "register_commands",
                command_count: commands.length,
                client_id: resolvedClientId,
            });

            const startTime = Date.now();

            yield* Effect.tryPromise({
                try: async () => {
                    await rest.put(Routes.applicationCommands(resolvedClientId), {
                        body: commands.map((c) => c.toJSON()),
                    });
                },
                catch: (e) => new DiscordError({ action: "registerCommands", cause: e }),
            });

            const duration_ms = Date.now() - startTime;

            yield* Effect.annotateCurrentSpan({
                command_count: commands.length,
                duration_ms,
            });

            yield* Effect.logInfo("discord commands registered", {
                service_name: "Discord",
                method: "registerCommands",
                operation_type: "register_commands",
                command_count: commands.length,
                duration_ms,
                latency_ms: duration_ms,
                client_id: resolvedClientId,
            });
        });

        const login = Effect.fn("Discord.login")(function* () {
            yield* Effect.logDebug("discord client logging in", {
                service_name: "Discord",
                method: "login",
                operation_type: "authentication",
                connection_state: "connecting",
            });

            const startTime = Date.now();

            yield* Effect.tryPromise({
                try: async () => {
                    await client.login(botToken);
                    client.user?.setActivity({
                        name: "eggz",
                        type: ActivityType.Watching,
                    });
                },
                catch: (e) => new DiscordError({ action: "login", cause: e }),
            });

            const duration_ms = Date.now() - startTime;

            yield* Effect.annotateCurrentSpan({
                duration_ms,
                activity_name: "eggz",
            });

            yield* Effect.logInfo("discord client logged in", {
                service_name: "Discord",
                method: "login",
                operation_type: "authentication",
                connection_state: "authenticated",
                duration_ms,
                latency_ms: duration_ms,
                activity_name: "eggz",
                activity_type: "Watching",
            });
        });

        const awaitReady = Effect.fn("Discord.awaitReady")(function* () {
            yield* Effect.logDebug("waiting for discord client ready", {
                service_name: "Discord",
                method: "awaitReady",
                operation_type: "await_ready",
                connection_state: "waiting",
            });

            const startTime = Date.now();

            const readyClient = yield* Effect.async<Client<true>, never>((resume) => {
                if (client.isReady()) {
                    resume(Effect.succeed(client));
                } else {
                    client.once(Events.ClientReady, (readyClient) => {
                        resume(Effect.succeed(readyClient));
                    });
                }
            });

            const duration_ms = Date.now() - startTime;

            yield* Effect.annotateCurrentSpan({
                user_tag: readyClient.user.tag,
                duration_ms,
            });

            yield* Effect.logInfo("discord client ready", {
                service_name: "Discord",
                method: "awaitReady",
                operation_type: "await_ready",
                connection_state: "ready",
                user_tag: readyClient.user.tag,
                duration_ms,
                latency_ms: duration_ms,
            });

            return readyClient;
        });

        const destroy = Effect.fn("Discord.destroy")(function* () {
            yield* Effect.logInfo("discord client destroying", {
                service_name: "Discord",
                method: "destroy",
                operation_type: "shutdown",
                connection_state: "destroying",
            });

            void (yield* Effect.sync(() => client.destroy()));

            yield* Effect.logInfo("discord client destroyed", {
                service_name: "Discord",
                method: "destroy",
                operation_type: "shutdown",
                connection_state: "destroyed",
            });
        });

        // Perform login and destroy as part of acquire/release
        const readyClient = yield* Effect.acquireRelease(
            Effect.gen(function* () {
                yield* login();
                return yield* awaitReady();
            }),
            destroy,
        );

        return { client: readyClient, rest, registerCommands } as const;
    }).pipe(Effect.annotateLogs({ service: "Discord" })),
}) {}

/** @deprecated Use Discord.Default instead */
export const DiscordLive = Discord.Default;
