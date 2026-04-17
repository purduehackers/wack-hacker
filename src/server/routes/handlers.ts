import { log } from "evlog";
import { resumeHook } from "workflow/api";

import type { EventHandler } from "@/bot/events/types";
import type { ChatHookEvent } from "@/workflows/chat";

import * as userEvents from "@/bot/handlers/events";
import { handleMention } from "@/bot/handlers/events";
import { isBotMention } from "@/bot/mention";
import { fetchRecentMessages } from "@/bot/recent-messages";
import { EventRouter } from "@/bot/router";
import { AgentContext } from "@/lib/ai/context";

export const router = new EventRouter();

router.onMention(handleMention);

router.onMessage(async (packet, ctx) => {
  // Mentions are already handled by `handleMention`, which calls `resumeHook`
  // with the mention prefix stripped. Forwarding again here would duplicate
  // the turn and push the un-stripped content into the conversation.
  if (isBotMention(packet.data.content, ctx.botUserId)) return;
  if (packet.data.thread) return;

  const channelId = packet.data.channel.id;
  const existing = await ctx.store.get(channelId);
  if (!existing) return;

  log.info("handlers", `Forwarding message to workflow ${existing.workflowRunId}`);

  try {
    const recentMessages = await fetchRecentMessages(ctx.discord, channelId, packet.data.id);
    const turnContext = AgentContext.fromPacket(packet, { recentMessages }).toJSON();
    const event: ChatHookEvent = {
      type: "message",
      content: packet.data.content,
      context: turnContext,
    };
    await resumeHook(existing.workflowRunId, event);
    await ctx.store.touch(channelId);
  } catch (err) {
    log.info("handlers", `Conversation ended for ${channelId}: ${String(err)}`);
    await ctx.store.delete(channelId);
  }
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
