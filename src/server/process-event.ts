import type { MessageMetadata, RetryDirective } from "@vercel/queue";

import type { HandlerContext } from "@/bot/types";
import type { Packet } from "@/lib/protocol/types";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { createDiscordAPI } from "@/lib/discord/client";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { getDedupKey } from "@/lib/protocol/events";

import { LockContentionError } from "./errors";

const MAX_RETRIES = 3;
// The channel lock is legitimately held for multi-second mention dispatches
// (thread create + history fetch + workflow start), so contention gets a
// larger redelivery budget at a short fixed delay — the generic budget of 2
// redeliveries would still drop messages under real contention.
const LOCK_MAX_DELIVERIES = 10;
const LOCK_RETRY_DELAY_SECONDS = 3;

export function eventRetryPolicy(error: unknown, metadata: MessageMetadata): RetryDirective {
  if (error instanceof LockContentionError) {
    if (metadata.deliveryCount >= LOCK_MAX_DELIVERIES) return { acknowledge: true };
    return { afterSeconds: LOCK_RETRY_DELAY_SECONDS };
  }
  if (metadata.deliveryCount >= MAX_RETRIES) return { acknowledge: true };
  return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
}

function getMessageChannelId(packet: Packet): string | null {
  if (packet.type !== "GATEWAY_MESSAGE_CREATE") return null;
  return packet.data.channel.id;
}

export async function processEvent(
  packet: Packet,
  store: ConversationStore,
  dispatch: (packet: Packet, ctx: HandlerContext) => Promise<void>,
): Promise<void> {
  const logger = createWideLogger({
    op: "event.process",
    event: { type: packet.type },
  });

  const dedupKey = getDedupKey(packet);
  if (!(await store.dedup(dedupKey))) {
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
        throw new LockContentionError(lockChannel);
      }
      try {
        await dispatch(packet, ctx);
      } finally {
        await store.releaseLock(lockChannel, token);
      }
    } else {
      await dispatch(packet, ctx);
    }
    countMetric("event.processed", { type: packet.type });
    logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
  } catch (err) {
    // Contention is expected under load and already emitted its own wide
    // event above; only real failures go through the error path so error
    // metrics stay meaningful.
    if (!(err instanceof LockContentionError)) {
      countMetric("event.error", { type: packet.type });
      logger.error(err as Error);
      logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
    }
    // Release the dedup claim so the queue's retry can actually re-run the
    // dispatch. Without this, a transient failure becomes a permanent lost
    // event — the claim sits until its 5-min TTL while every retry
    // short-circuits as "dedup_hit". Not every handler owns a non-reexecution
    // invariant (the chat workflow hook loop has no per-message dedup), so a
    // retry after partial side effects can duplicate a turn — the same
    // accepted tradeoff the tasks route documents.
    await store.releaseDedup(dedupKey).catch(() => {});
    throw err;
  } finally {
    recordDuration("event.process_duration", Date.now() - startTime, { type: packet.type });
  }
}
