import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import { getVercelOidcTokenSync } from "@vercel/functions/oidc";
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { log } from "evlog";
import { Hono } from "hono";
import { once } from "node:events";
import { monotonicFactory } from "ulid";

import type { Packet } from "@/lib/protocol/types";

import { env } from "@/env";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { PacketCodec } from "@/lib/protocol/packets";
import { isTextChannel } from "@/lib/protocol/utils";
import { send } from "@/lib/tasks/queue/client";
import { DISCORD_EVENT_TOPIC } from "@/lib/tasks/queue/constants";

import { HANDOFF_WAIT_MS, READY_TIMEOUT_MS } from "./constants";

const HOLD_MS = 10 * 60 * 1000;
const LEADER_KEY = "gateway:leader";
const LEASE_TTL_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;

// Atomic compare-and-delete: only removes the lease if we still own it.
// Without this, a get-then-del race could delete a new leader's key after
// we read our own ID but before the del reached Redis.
const RELEASE_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const ulid = monotonicFactory();

async function relay(packet: Packet, oidcToken: string): Promise<void> {
  return withSpan("gateway.relay", { "packet.type": packet.type }, async () => {
    const logger = createWideLogger({
      op: "gateway.relay",
      event: { type: packet.type },
    });
    const startTime = Date.now();
    try {
      await send(DISCORD_EVENT_TOPIC, PacketCodec.encode(packet), { oidcToken });
      countMetric("gateway.packet.relayed", { type: packet.type });
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
    } catch (err) {
      countMetric("gateway.packet.relay_failed", { type: packet.type });
      logger.error(err as Error);
      logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
    }
  });
}

type Publish = (packet: Packet) => Promise<void>;

async function releaseLease(redis: Redis, listenerId: string): Promise<void> {
  try {
    const released = await redis.eval<[string], number>(
      RELEASE_LEASE_SCRIPT,
      [LEADER_KEY],
      [listenerId],
    );
    if (released === 1) {
      countMetric("gateway.lease.released");
      log.info("gateway", `released lease for ${listenerId}`);
    }
  } catch (err) {
    countMetric("gateway.lease.release_failed");
    log.error("gateway", `lease release failed: ${String(err)}`);
  }
}

async function destroyClient(client: Client, listenerId: string): Promise<void> {
  log.info("gateway", `destroying client ${listenerId}`);
  try {
    await client.destroy();
  } catch (err) {
    log.error("gateway", `destroy failed: ${String(err)}`);
  }
}

// Acquires the leader lease and logs the client in. Resolves once Discord
// emits ClientReady; returns a `hold` promise that runs the 10-minute lease
// renewal loop and tears everything down when it completes or loses leadership.
// Throws (and cleans up) if login or the ready handshake fails.
async function startGatewayListener(client: Client): Promise<{ hold: Promise<void> }> {
  const redis = Redis.fromEnv();
  const listenerId = `gw_${ulid()}`;
  const abort = new AbortController();
  const logger = createWideLogger({
    op: "gateway.listener",
    gateway: { listener_id: listenerId },
  });

  countMetric("gateway.listener.started");
  logger.info("listener starting");

  const existing = await redis.get<string>(LEADER_KEY).catch(() => null);
  await redis.set(LEADER_KEY, listenerId, { px: LEASE_TTL_MS });

  if (existing && existing !== listenerId) {
    logger.info("prior leader detected, waiting for handoff", {
      prior_leader: existing,
      handoff_wait_ms: HANDOFF_WAIT_MS,
    });
    await new Promise((r) => setTimeout(r, HANDOFF_WAIT_MS));
  }

  const poll = setInterval(async () => {
    if (abort.signal.aborted) return;
    try {
      const current = await redis.get<string>(LEADER_KEY);
      if (current !== listenerId) {
        countMetric("gateway.leader.lost");
        logger.info("leadership lost", { current_leader: current ?? null });
        abort.abort();
        return;
      }
      await redis.set(LEADER_KEY, listenerId, { px: LEASE_TTL_MS });
    } catch (err) {
      countMetric("gateway.lease.poll_failed");
      logger.warn("lease poll failed", { reason: String(err) });
    }
  }, POLL_INTERVAL_MS);

  try {
    // Combine the lease-loss abort with a hard timeout so the route can't
    // hang indefinitely if login resolves but ClientReady never fires.
    // Either signal rejects the once() wait and triggers cleanup below.
    const readySignal = AbortSignal.any([abort.signal, AbortSignal.timeout(READY_TIMEOUT_MS)]);
    const ready = once(client, Events.ClientReady, { signal: readySignal });
    await client.login(env.DISCORD_BOT_TOKEN);
    await ready;
    countMetric("gateway.listener.ready");
    logger.set({ ready: true });
  } catch (err) {
    countMetric("gateway.listener.login_failed");
    logger.error(err as Error);
    logger.emit({ outcome: "login_failed" });
    clearInterval(poll);
    await destroyClient(client, listenerId);
    await releaseLease(redis, listenerId);
    throw err;
  }

  const hold = (async () => {
    const holdStart = Date.now();
    let exitReason: string = "hold_elapsed";
    try {
      // Fast-path: abort fired between ready and hold-executor running.
      // AbortSignal listeners added post-abort never fire, so teardown
      // would otherwise wait out the full HOLD_MS.
      if (abort.signal.aborted) {
        exitReason = "aborted_pre_hold";
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), HOLD_MS);
        abort.signal.addEventListener(
          "abort",
          () => {
            exitReason = "aborted";
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    } finally {
      recordDuration("gateway.listener.hold_duration", Date.now() - holdStart);
      clearInterval(poll);
      await destroyClient(client, listenerId);
      await releaseLease(redis, listenerId);
      logger.emit({
        outcome: "ok",
        exit_reason: exitReason,
        hold_duration_ms: Date.now() - holdStart,
      });
    }
  })();

  return { hold };
}

const route = new Hono();

function bindMessageHandlers(client: Client, publish: Publish): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !isTextChannel(message.channel)) return;

    await publish({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: new Date(),
      data: {
        id: message.id,
        attachments: message.attachments.map((a) => ({
          id: a.id,
          url: a.url,
          filename: a.name,
          contentType: a.contentType ?? undefined,
          size: a.size,
          width: a.width ?? undefined,
          height: a.height ?? undefined,
        })),
        author: {
          id: message.author.id,
          username: message.author.username,
          nickname: message.author.displayName,
          bot: message.author.bot,
          avatarHash: message.author.avatar ?? undefined,
        },
        channel: { id: message.channel.id, name: message.channel.name },
        thread:
          message.channel.isThread() && message.channel.parent
            ? {
                parentId: message.channel.parentId!,
                parentName: message.channel.parent.name,
              }
            : undefined,
        content: message.content,
        guildId: message.guildId!,
        timestamp: message.createdAt.toISOString(),
        memberRoles: [...(message.member?.roles.cache.keys() ?? [])],
        flags: message.flags?.bitfield,
        categoryId: message.channel.isThread()
          ? undefined
          : (message.channel.parentId ?? undefined),
        forwardedSnapshots: (message as any).messageSnapshots?.map((s: any) => ({
          content: s.content ?? undefined,
          attachments: s.attachments?.map((a: any) => ({
            id: a.id,
            url: a.url,
            filename: a.name,
            contentType: a.contentType ?? undefined,
            size: a.size,
            width: a.width ?? undefined,
            height: a.height ?? undefined,
          })),
        })),
        mentions: [...message.mentions.users.keys()],
        reference: message.reference?.messageId
          ? {
              messageId: message.reference.messageId,
              channelId: message.reference.channelId ?? undefined,
              authorId: message.mentions.repliedUser?.id,
            }
          : undefined,
      },
    });
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;
    const message = await reaction.message.fetch();

    await publish({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: new Date(),
      data: {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId!,
        emoji: { id: reaction.emoji.id, name: reaction.emoji.name ?? "" },
        creator: { id: user.id, username: user.username ?? "unknown" },
      },
    });
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (user.bot) return;
    const message = await reaction.message.fetch();

    await publish({
      type: "GATEWAY_MESSAGE_REACTION_REMOVE",
      timestamp: new Date(),
      data: {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId!,
        emoji: { id: reaction.emoji.id, name: reaction.emoji.name ?? "" },
        creator: { id: user.id, username: user.username ?? "unknown" },
      },
    });
  });
}

function bindGuildHandlers(client: Client, publish: Publish): void {
  client.on(Events.MessageUpdate, async (_old, message) => {
    if (!message.guildId || message.author?.bot) return;

    await publish({
      type: "GATEWAY_MESSAGE_UPDATE",
      timestamp: new Date(),
      data: {
        id: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
      },
    });
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!message.guildId) return;

    await publish({
      type: "GATEWAY_MESSAGE_DELETE",
      timestamp: new Date(),
      data: {
        id: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
      },
    });
  });
  client.on(Events.VoiceStateUpdate, async (_old, state) => {
    if (!state.guild?.id) return;

    await publish({
      type: "GATEWAY_VOICE_STATE_UPDATE",
      timestamp: new Date(),
      data: {
        userId: state.id,
        guildId: state.guild.id,
        channelId: state.channelId,
        sessionId: state.sessionId ?? "",
        selfMute: state.selfMute ?? false,
        selfDeaf: state.selfDeaf ?? false,
      },
    });
  });

  client.on(Events.ThreadCreate, async (thread) => {
    if (!thread.guildId || !thread.parentId) return;

    await publish({
      type: "GATEWAY_THREAD_CREATE",
      timestamp: new Date(),
      data: {
        id: thread.id,
        name: thread.name,
        parentId: thread.parentId,
        guildId: thread.guildId,
        ownerId: thread.ownerId ?? "",
      },
    });
  });
}

route.get("/gateway", async (c) => {
  let oidcToken: string;
  try {
    oidcToken = getVercelOidcTokenSync();
  } catch (err) {
    log.error("gateway", `OIDC token unavailable at route entry: ${String(err)}`);
    return c.json({ error: "oidc unavailable" }, 500);
  }
  const publish: Publish = (packet) => relay(packet, oidcToken);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
    presence: {
      status: "online",
      activities: [
        {
          name: "something eggz",
          type: ActivityType.Watching,
        },
      ],
    },
  });

  client.on(Events.ClientReady, () => {
    log.info("gateway", `Logged in as ${client.user?.tag}`);
  });

  client.on(Events.Error, (err) => {
    log.error("gateway", `client error: ${String(err)}`);
  });
  client.on(Events.ShardError, (err, shardId) => {
    log.error("gateway", `shard ${shardId} error: ${String(err)}`);
  });
  client.on(Events.ShardDisconnect, (event, shardId) => {
    log.warn("gateway", `shard ${shardId} disconnect code=${event.code} reason=${event.reason}`);
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    log.info("gateway", `shard ${shardId} reconnecting`);
  });
  client.on(Events.ShardResume, (shardId, replayed) => {
    log.info("gateway", `shard ${shardId} resumed, replayed ${replayed}`);
  });
  client.on("raw" as any, (packet: { t?: string | null; op?: number }) => {
    if (packet?.t) log.info("gateway", `raw dispatch t=${packet.t}`);
  });

  bindMessageHandlers(client, publish);
  bindGuildHandlers(client, publish);

  let hold: Promise<void>;
  try {
    ({ hold } = await startGatewayListener(client));
  } catch {
    return c.json({ error: "gateway failed to become ready" }, 500);
  }

  waitUntil(hold);
  return c.json({ message: "ok" });
});

export default route;
