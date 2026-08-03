/**
 * The Discord gateway client.
 *
 * This is the whole reason the bot is a long-running process. The legacy app had
 * to run a discord.js client inside a Vercel Function for a 10-minute hold,
 * re-invoked by a nine-minute cron and arbitrated by a Redis leader lease,
 * because a function cannot hold a WebSocket. None of that exists here: one
 * process, one connection, no lease, no election.
 *
 * Two consequences of being a gateway app rather than an HTTP-interactions app
 * are worth stating, because they delete a lot of legacy code:
 *
 * 1. **`INTERACTION_CREATE` arrives over the WebSocket.** Because no Interactions
 *    Endpoint URL is configured, Discord delivers slash commands and component
 *    clicks down the same socket. That removes ed25519 signature verification,
 *    the 3-second defer dance, `waitUntil`, and the modal-versus-defer special
 *    case — roughly the entire `src/lib/protocol` layer.
 * 2. **Events are handled in-process.** No packet codec, no Vercel Queue, no
 *    consumer function. Handlers are plain listeners.
 *
 * The intents are the minimum for the features that exist: `MessageContent` is
 * privileged and required to read message text at all, and
 * `GuildMessageReactions` covers the ✅-to-end-a-conversation and feedback
 * reactions. Partials matter because a reaction or delete can arrive for a
 * message the client never cached — the legacy app published reactions straight
 * off the partial so a reaction on a just-deleted message still relayed.
 */

import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

import { onShutdown } from "./lifecycle.ts";

export interface GatewayDeps {
  readonly token: string;
  /** Reports gateway-level failures that are nobody's request. */
  readonly onError: (error: unknown, context: { readonly op: string }) => void;
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
    presence: { activities: [{ name: "something eggz", type: 3 }], status: "online" },
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
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}
