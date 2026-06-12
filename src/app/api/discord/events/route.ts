import { handleCallback } from "@/lib/tasks/queue/client";
import { handleDiscordEvent } from "@/server/process-event";

const MAX_RETRIES = 3;

export const POST = handleCallback<string>(
  (encoded, metadata) => handleDiscordEvent(encoded, metadata),
  {
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_RETRIES) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);
