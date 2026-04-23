import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";

import type { Packet } from "@/lib/protocol/types";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { createWideLogger } from "@/lib/logging/wide";
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
  const logger = createWideLogger({
    op: "event.process",
    event: { type: packet.type },
  });

  if (!(await store.dedup(getDedupKey(packet)))) {
    countMetric("event.dedup_hit", { type: packet.type });
    logger.emit({ outcome: "dedup_hit" });
    return;
  }

  const ctx = {
    discord: new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN)),
    store,
    botUserId: env.DISCORD_BOT_CLIENT_ID,
  };

  const startTime = Date.now();
  const lockChannel = getMessageChannelId(packet);
  if (lockChannel) logger.set({ lock: { channel_id: lockChannel } });

  try {
    if (lockChannel) {
      const token = await store.acquireLock(lockChannel);
      if (!token) {
        countMetric("event.lock_contention", { type: packet.type });
        logger.emit({ outcome: "lock_contention", duration_ms: Date.now() - startTime });
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
    logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
  } catch (err) {
    countMetric("event.error", { type: packet.type });
    logger.error(err as Error);
    logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
    throw err;
  } finally {
    recordDuration("event.process_duration", Date.now() - startTime, { type: packet.type });
  }
}
