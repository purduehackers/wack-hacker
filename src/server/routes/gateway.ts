import { waitUntil } from "@vercel/functions";
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { log } from "evlog";
import { Hono } from "hono";

import type { Packet } from "@/lib/protocol/types";

import { env } from "@/env";
import { PacketCodec } from "@/lib/protocol/packets";
import { isTextChannel } from "@/lib/protocol/utils";

const VERCEL_MAX_FUNCTION_DURATION_MS = 10 * 60 * 1000;

const extend = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function getInboundUrl(): string {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
  return `${base}/api/discord/inbound`;
}

async function relay(url: string, packet: Packet): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.INBOUND_SECRET}`,
      },
      body: PacketCodec.encode(packet),
    });
  } catch (err) {
    log.error("gateway", `Failed to relay packet: ${String(err)}`);
  }
}

const route = new Hono();

function bindMessageHandlers(client: Client, inboundUrl: string): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !isTextChannel(message.channel)) return;

    await relay(inboundUrl, {
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
            ? { parentId: message.channel.parentId!, parentName: message.channel.parent.name }
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

    await relay(inboundUrl, {
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

    await relay(inboundUrl, {
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

function bindGuildHandlers(client: Client, inboundUrl: string): void {
  client.on(Events.MessageUpdate, async (_old, message) => {
    if (!message.guildId || message.author?.bot) return;

    await relay(inboundUrl, {
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

    await relay(inboundUrl, {
      type: "GATEWAY_MESSAGE_DELETE",
      timestamp: new Date(),
      data: { id: message.id, channelId: message.channelId, guildId: message.guildId },
    });
  });
  client.on(Events.VoiceStateUpdate, async (_old, state) => {
    if (!state.guild?.id) return;

    await relay(inboundUrl, {
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

    await relay(inboundUrl, {
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
  const inboundUrl = getInboundUrl();

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

  bindMessageHandlers(client, inboundUrl);
  bindGuildHandlers(client, inboundUrl);

  void client.login(env.DISCORD_BOT_TOKEN);

  waitUntil(extend(VERCEL_MAX_FUNCTION_DURATION_MS));

  return c.json({ message: "ok" });
});

export default route;
