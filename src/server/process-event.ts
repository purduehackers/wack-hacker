import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";

import type { Packet } from "@/lib/protocol/types";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { countMetric, recordDuration } from "@/lib/metrics";

import { router } from "./routes/handlers";

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

export async function processEvent(packet: Packet, store: ConversationStore): Promise<void> {
  if (!(await store.dedup(getDedupKey(packet)))) {
    log.debug("events", `Dedup hit, skipping ${packet.type}`);
    countMetric("event.dedup_hit", { type: packet.type });
    return;
  }

  const ctx = {
    discord: new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN)),
    store,
    botUserId: env.DISCORD_CLIENT_ID,
  };

  const startTime = Date.now();
  const lockChannel = getMessageChannelId(packet);
  try {
    if (lockChannel) {
      const token = await store.acquireLock(lockChannel);
      if (!token) {
        log.warn("events", `Lock held for ${lockChannel}, dropping ${packet.type}`);
        countMetric("event.lock_contention", { type: packet.type });
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
    countMetric("event.processed", { type: packet.type });
  } catch (err) {
    countMetric("event.error", { type: packet.type });
    throw err;
  } finally {
    recordDuration("event.process_duration", Date.now() - startTime, { type: packet.type });
  }
}
