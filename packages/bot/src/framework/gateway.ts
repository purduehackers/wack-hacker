/**
 * The single long-running Discord gateway identity.
 *
 * Interactions and events arrive over one WebSocket and all REST calls share
 * discord.js's rate-limit manager. The selected intents are the minimum needed
 * for message content, reactions, and community features; partials cover events
 * for messages that were not cached by this process.
 */

import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from "discord.js";

import { onShutdown } from "./lifecycle.ts";

interface GatewayDeps {
  readonly token: string;
  /** Reports gateway-level failures that are nobody's request. */
  readonly onError: (error: Error, context: { readonly op: string }) => void;
}

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Privileged. Without it every message arrives with empty content.
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    // A reaction or delete can reference a message the client never cached.
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
    presence: {
      activities: [{ name: "something eggz", type: ActivityType.Watching }],
      status: "online",
    },
  });
}

/**
 * Logs in and resolves once the gateway reports ready.
 *
 * Readiness is awaited rather than assumed so the health endpoint cannot report
 * a bot that is up while its socket is still connecting, and so a bad token
 * fails at startup instead of silently never receiving events.
 */
export async function connect(
  client: Client,
  deps: GatewayDeps,
): Promise<Result<Client<true>, Transient>> {
  // discord.js does not await its listeners, so an unhandled rejection inside
  // one is silently lost. Every gateway-level listener reports instead.
  client.on(Events.Error, (error) => deps.onError(error, { op: "gateway.client_error" }));
  client.on(Events.ShardError, (error) => deps.onError(error, { op: "gateway.shard_error" }));
  client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn(`gateway shard ${shardId} disconnected code=${event.code}`);
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    console.warn(`gateway shard ${shardId} reconnecting`);
  });
  client.on(Events.ShardResume, (shardId, replayed) => {
    console.info(`gateway shard ${shardId} resumed replayed=${replayed}`);
  });

  onShutdown("gateway", async () => {
    await client.destroy();
  });

  const ready = new Promise<Client<true>>((resolve) => {
    client.once(Events.ClientReady, (readyClient) => resolve(readyClient));
  });

  return Result.tryPromise({
    try: async () => {
      await client.login(deps.token);
      return await ready;
    },
    catch: (cause) =>
      new Transient({
        operation: "gateway login",
        detail: messageOf(cause),
      }),
  });
}
