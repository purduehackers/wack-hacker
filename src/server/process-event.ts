import type { Packet } from "@/lib/protocol/types";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { createDiscordAPI } from "@/lib/discord/client";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { getDedupKey } from "@/lib/protocol/events";
import { PacketCodec } from "@/lib/protocol/packets";

import { router } from "./routes/handlers";

/**
 * Queue-consumer entrypoint: decode the wire payload and process it. Decode
 * failures are deterministic — retrying can't fix them — so the message is
 * dropped (a clean return acknowledges it) with a metric instead of burning
 * the retry budget. This is also what absorbs in-flight packets of a type the
 * previous deploy still published.
 */
export async function handleDiscordEvent(
  encoded: string,
  metadata: { deliveryCount: number; messageId: string },
  store: ConversationStore = new ConversationStore(),
): Promise<void> {
  let packet: Packet;
  try {
    packet = PacketCodec.decode(encoded);
  } catch (err) {
    countMetric("discord.event.decode_failed");
    createWideLogger({ op: "discord.event.callback" }).warn("packet decode failed, dropping", {
      reason: String(err),
    });
    return;
  }
  return withSpan(
    "discord.event",
    {
      "packet.type": packet.type,
      "delivery.count": metadata.deliveryCount,
    },
    async () => {
      const logger = createWideLogger({
        op: "discord.event.callback",
        event: { type: packet.type },
        queue: { delivery_count: metadata.deliveryCount, message_id: metadata.messageId },
      });
      const startTime = Date.now();
      countMetric("discord.event.callback_received", { type: packet.type });
      try {
        await processEvent(packet, store);
        logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
      } catch (err) {
        countMetric("discord.event.callback_error", { type: packet.type });
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
        throw err;
      } finally {
        recordDuration("discord.event.callback_duration", Date.now() - startTime, {
          type: packet.type,
        });
      }
    },
  );
}

function getMessageChannelId(packet: Packet): string | null {
  if (packet.type !== "GATEWAY_MESSAGE_CREATE") return null;
  return packet.data.channel.id;
}

async function processEvent(packet: Packet, store: ConversationStore): Promise<void> {
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
    discord: createDiscordAPI(),
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
