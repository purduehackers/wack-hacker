import { ConversationStore } from "@/bot/store";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { PacketCodec } from "@/lib/protocol/packets";
import { handleCallback } from "@/lib/tasks/queue/client";
import { LockContentionError } from "@/server/errors";
import { eventRetryPolicy, processEvent } from "@/server/process-event";
import { router } from "@/server/routes/handlers";

export const POST = handleCallback<string>(
  async (encoded, metadata) => {
    const packet = PacketCodec.decode(encoded);
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
          const store = new ConversationStore();
          await processEvent(packet, store, (p, ctx) => router.dispatch(p, ctx));
          logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
        } catch (err) {
          // Contention is expected while a mention dispatch holds the channel
          // lock; log it as a warning so it doesn't inflate error metrics.
          // The retry policy redelivers it on a short fixed delay.
          if (err instanceof LockContentionError) {
            logger.warn("channel lock contended, deferring to redelivery", {
              channel_id: err.channelId,
            });
            logger.emit({ outcome: "lock_contention", duration_ms: Date.now() - startTime });
          } else {
            countMetric("discord.event.callback_error", { type: packet.type });
            logger.error(err as Error);
            logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
          }
          throw err;
        } finally {
          recordDuration("discord.event.callback_duration", Date.now() - startTime, {
            type: packet.type,
          });
        }
      },
    );
  },
  {
    retry: eventRetryPolicy,
  },
);
