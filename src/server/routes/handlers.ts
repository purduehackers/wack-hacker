import { resumeHook } from "workflow/api";

import type { EventHandler } from "@/bot/events/types";
import type { ChatHookEvent } from "@/workflows/chat";

import * as userEvents from "@/bot/handlers/events";
import { handleMention } from "@/bot/handlers/events";
import { isBotMention } from "@/bot/mention";
import { EventRouter } from "@/bot/router";
import { AgentContext } from "@/lib/ai/context";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";
import { captureTraceparent, withSpan } from "@/lib/otel/tracing";

export const router = new EventRouter();

router.onMention(handleMention);

router.onMessage(async (packet, ctx) => {
  // Mentions are already handled by `handleMention`, which calls `resumeHook`
  // with the mention prefix stripped. Forwarding again here would duplicate
  // the turn and push the un-stripped content into the conversation.
  if (isBotMention(packet.data, ctx.botUserId)) return;
  if (packet.data.thread) return;

  const channelId = packet.data.channel.id;
  const existing = await ctx.store.get(channelId);
  if (!existing) return;

  return withSpan(
    "chat.resume_hook",
    {
      "chat.id": existing.workflowRunId,
      "chat.channel_id": channelId,
      "chat.workflow_run_id": existing.workflowRunId,
    },
    async () => {
      const logger = createWideLogger({
        op: "chat.resume_hook",
        chat: {
          id: existing.workflowRunId,
          workflow_run_id: existing.workflowRunId,
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
  switch (h.type) {
    case "message":
      router.onMessage((p, c) => h.handle(p, c));
      break;
    case "reactionAdd":
      router.onReactionAdd((p, c) => h.handle(p, c));
      break;
    case "reactionRemove":
      router.onReactionRemove((p, c) => h.handle(p, c));
      break;
    case "messageDelete":
      router.onMessageDelete((p, c) => h.handle(p, c));
      break;
    case "messageUpdate":
      router.onMessageUpdate((p, c) => h.handle(p, c));
      break;
    case "voiceStateUpdate":
      router.onVoiceStateUpdate((p, c) => h.handle(p, c));
      break;
    case "threadCreate":
      router.onThreadCreate((p, c) => h.handle(p, c));
      break;
  }
}
