import { ConversationStore } from "@/bot/store";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { PacketCodec } from "@/lib/protocol/packets";
import { handleCallback } from "@/lib/tasks/queue/client";
import { processEvent } from "@/server/process-event";

const MAX_RETRIES = 3;

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
  },
  {
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_RETRIES) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);
