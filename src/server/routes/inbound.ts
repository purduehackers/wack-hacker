import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { waitUntil } from "@vercel/functions";
import { log } from "evlog";
import { Hono } from "hono";

import type { Packet } from "@/lib/protocol/types";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { PacketCodec } from "@/lib/protocol/packets";

import { router } from "./handlers";

function getDedupKey(packet: Packet): string {
  switch (packet.type) {
    case "GATEWAY_MESSAGE_CREATE":
      return `msg:${packet.data.id}`;
    case "GATEWAY_MESSAGE_REACTION_ADD":
      return `react:${packet.data.messageId}:${packet.data.creator.id}:${packet.data.emoji.id ?? packet.data.emoji.name}`;
    case "GATEWAY_MESSAGE_REACTION_REMOVE":
      return `unreact:${packet.data.messageId}:${packet.data.creator.id}:${packet.data.emoji.id ?? packet.data.emoji.name}`;
    case "GATEWAY_MESSAGE_DELETE":
      return `del:${packet.data.id}`;
    case "GATEWAY_MESSAGE_UPDATE":
      return `upd:${packet.data.id}:${packet.timestamp.getTime()}`;
    case "GATEWAY_VOICE_STATE_UPDATE":
      return `voice:${packet.data.userId}:${packet.data.channelId ?? "left"}:${packet.timestamp.getTime()}`;
    case "GATEWAY_THREAD_CREATE":
      return `thread:${packet.data.id}`;
  }
}

function getMessageChannelId(packet: Packet): string | null {
  if (packet.type !== "GATEWAY_MESSAGE_CREATE") return null;
  return packet.data.channel.id;
}

async function processEvent(packet: Packet, store: ConversationStore): Promise<void> {
  if (!(await store.dedup(getDedupKey(packet)))) {
    log.debug("inbound", `Dedup hit, skipping ${packet.type}`);
    return;
  }

  const ctx = {
    discord: new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN)),
    store,
    botUserId: env.DISCORD_CLIENT_ID,
  };

  const lockChannel = getMessageChannelId(packet);
  if (lockChannel) {
    const token = await store.acquireLock(lockChannel);
    if (!token) {
      log.warn("inbound", `Lock held for ${lockChannel}, dropping ${packet.type}`);
      return;
    }
    try {
      await router.dispatch(packet, ctx);
    } finally {
      await store.releaseLock(lockChannel, token);
    }
  } else {
    await router.dispatch(packet, ctx);
  }
}

const route = new Hono();

route.post("/inbound", async (c) => {
  // Only the gateway relay (running in a separate function) should post here.
  // A shared bearer secret keeps anyone else from forging Discord events.
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${env.INBOUND_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const raw = await c.req.text();
  const store = new ConversationStore();

  let packet: Packet;
  try {
    packet = PacketCodec.decode(raw);
  } catch (err) {
    log.error("inbound", `Invalid packet: ${String(err)}`);
    return c.json({ error: "Invalid packet" }, 400);
  }

  log.info("inbound", `Received ${packet.type}`);

  waitUntil(
    processEvent(packet, store).catch((err) =>
      log.error("inbound", `Processing failed for ${packet.type}: ${String(err)}`),
    ),
  );

  return c.json({ ok: true });
});

export default route;
