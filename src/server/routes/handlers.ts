import { log } from "evlog";
import { resumeHook } from "workflow/api";

import type { EventHandler } from "@/lib/bot/events/types";

import * as userEvents from "@/lib/bot/handlers/events";
import { handleMention } from "@/lib/bot/handlers/events";
import { EventRouter } from "@/lib/bot/router";

export const router = new EventRouter();

router.onMention(handleMention);

router.onMessage(async (packet, ctx) => {
  // Mentions are already handled by `handleMention`, which calls `resumeHook`
  // with the mention prefix stripped. Forwarding again here would duplicate
  // the turn and push the un-stripped content into the conversation.
  if (packet.data.content.startsWith(`<@${ctx.botUserId}>`)) return;

  const channelId = packet.data.channel.id;
  const threadId = packet.data.thread ? packet.data.channel.id : undefined;
  const existing = await ctx.store.get(channelId, threadId);
  if (!existing) return;

  log.info("handlers", `Forwarding message to workflow ${existing.workflowRunId}`);

  try {
    await resumeHook(existing.workflowRunId, {
      type: "message" as const,
      content: packet.data.content,
      authorId: packet.data.author.id,
      authorUsername: packet.data.author.username,
    });
    await ctx.store.touch(channelId, threadId);
  } catch (err) {
    log.info("handlers", `Conversation ended for ${channelId}: ${String(err)}`);
    await ctx.store.delete(channelId, threadId);
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
