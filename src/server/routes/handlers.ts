import { resumeHook } from "workflow/api";

import type { EventHandler } from "@/bot/events/types";
import type { ChatHookEvent } from "@/workflows/chat";

import * as userEvents from "@/bot/handlers/events";
import { handleMention } from "@/bot/handlers/events";
import { EventRouter } from "@/bot/router";
import { AgentContext } from "@/lib/ai/context";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";
import { captureTraceparent, withSpan } from "@/lib/otel/tracing";

export const router = new EventRouter();

router.on("mention", handleMention);

router.on("message", async (packet, ctx) => {
  // Mentions are already handled by `handleMention`, which calls `resumeHook`
  // with the mention prefix stripped. Forwarding again here would duplicate
  // the turn and push the un-stripped content into the conversation.
  if (ctx.isBotMention) return;
  if (packet.data.thread) return;

  const channelId = packet.data.channel.id;
  const existing = await ctx.store.get(channelId);
  if (!existing) return;

  return withSpan(
    "chat.resume_hook",
    {
      "chat.id": existing.workflowRunId,
      "chat.channel_id": channelId,
      "chat.user_id": packet.data.author.id,
    },
    async () => {
      const logger = createWideLogger({
        op: "chat.resume_hook",
        chat: {
          id: existing.workflowRunId,
          channel_id: channelId,
          user_id: packet.data.author.id,
        },
      });
      try {
        const turnContext = AgentContext.fromPacket(packet).toJSON();
        const event: ChatHookEvent = {
          type: "message",
          content: packet.data.content,
          context: turnContext,
          traceparent: captureTraceparent(),
        };
        await resumeHook(existing.workflowRunId, event);
        await ctx.store.touch(channelId);
        countMetric("chat.resume_hook.ok");
        logger.emit({ outcome: "ok" });
      } catch (err) {
        countMetric("chat.resume_hook.ended");
        await ctx.store.delete(channelId);
        logger.warn("workflow ended", { reason: String(err) });
        logger.emit({ outcome: "ended" });
      }
    },
  );
});

for (const h of Object.values(userEvents) as EventHandler[]) {
  if (!h?.type) continue;
  router.register(h);
}
