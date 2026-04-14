import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { log } from "evlog";
import { Hono } from "hono";
import { monotonicFactory } from "ulid";

import type { Packet } from "@/lib/protocol/types";

import { env } from "@/env";
import { PacketCodec } from "@/lib/protocol/packets";
import { isTextChannel } from "@/lib/protocol/utils";
import { send } from "@/lib/tasks/queue/client";
import { DISCORD_EVENT_TOPIC } from "@/lib/tasks/queue/constants";

const HOLD_MS = 10 * 60 * 1000;
const LEADER_KEY = "gateway:leader";
const LEASE_TTL_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const HANDOFF_WAIT_MS = 8_000;

const ulid = monotonicFactory();

async function relay(packet: Packet): Promise<void> {
  try {
    await send(DISCORD_EVENT_TOPIC, PacketCodec.encode(packet));
  } catch (err) {
    log.error("gateway", `Failed to publish packet: ${String(err)}`);
  }
}

async function runGatewayListener(client: Client): Promise<void> {
  const redis = Redis.fromEnv();
  const listenerId = `gw_${ulid()}`;
  const abort = new AbortController();

  log.info("gateway", `listener ${listenerId} starting`);

  const existing = await redis.get<string>(LEADER_KEY).catch(() => null);
  await redis.set(LEADER_KEY, listenerId, { px: LEASE_TTL_MS });

  if (existing && existing !== listenerId) {
    log.info(
      "gateway",
      `prior leader ${existing} detected, waiting ${HANDOFF_WAIT_MS}ms for handoff`,
    );
    await new Promise((r) => setTimeout(r, HANDOFF_WAIT_MS));
  }

  const poll = setInterval(async () => {
    if (abort.signal.aborted) return;
    try {
      const current = await redis.get<string>(LEADER_KEY);
      if (current !== listenerId) {
        log.info(
          "gateway",
          `leadership lost (current=${current ?? "null"}), aborting ${listenerId}`,
        );
        abort.abort();
        return;
      }
      await redis.set(LEADER_KEY, listenerId, { px: LEASE_TTL_MS });
    } catch (err) {
      log.error("gateway", `lease poll failed: ${String(err)}`);
    }
  }, POLL_INTERVAL_MS);

  try {
    await client.login(env.DISCORD_BOT_TOKEN);
    log.info("gateway", `login() resolved for ${listenerId}`);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        log.info("gateway", `hold elapsed for ${listenerId}`);
        resolve();
      }, HOLD_MS);
      abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  } catch (err) {
    log.error("gateway", `login/hold failed: ${String(err)}`);
  } finally {
    clearInterval(poll);
    log.info("gateway", `destroying client ${listenerId}`);
    try {
      await client.destroy();
    } catch (err) {
      log.error("gateway", `destroy failed: ${String(err)}`);
    }
    try {
      const current = await redis.get<string>(LEADER_KEY);
      if (current === listenerId) {
        await redis.del(LEADER_KEY);
        log.info("gateway", `released lease for ${listenerId}`);
      }
    } catch (err) {
      log.error("gateway", `lease release failed: ${String(err)}`);
    }
  }
}

const route = new Hono();

function bindMessageHandlers(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !isTextChannel(message.channel)) return;

    await relay({
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
          })),
        })),
      },
    });
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;
    const message = await reaction.message.fetch();

    await relay({
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

    await relay({
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

function bindGuildHandlers(client: Client): void {
  client.on(Events.MessageUpdate, async (_old, message) => {
    if (!message.guildId || message.author?.bot) return;

    await relay({
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

    await relay({
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

    await relay({
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

    await relay({
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

route.get("/gateway", (c) => {
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

  bindMessageHandlers(client);
  bindGuildHandlers(client);

  const loginAndHold = runGatewayListener(client);

  waitUntil(loginAndHold);

  return c.json({ message: "ok" });
});

export default route;
