import { log } from "evlog";

import { ConversationStore } from "@/bot/store";
import { PacketCodec } from "@/lib/protocol/packets";
import { handleCallback } from "@/lib/tasks/queue/client";
import { processEvent } from "@/server/process-event";

const MAX_RETRIES = 3;

export const POST = handleCallback<string>(
  async (encoded, metadata) => {
    const packet = PacketCodec.decode(encoded);
    log.info("events", `Received ${packet.type} (attempt ${metadata.deliveryCount})`);

    const store = new ConversationStore();
    await processEvent(packet, store);
  },
  {
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_RETRIES) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);
