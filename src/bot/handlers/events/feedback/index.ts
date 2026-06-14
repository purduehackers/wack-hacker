import { defineEvent } from "@/bot/events/define";
import { TurnMessageStore } from "@/bot/turn-message-store";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";

// Thumbs-up, red heart (with the variation selector Discord sends), fire, 100, check.
const POSITIVE_EMOJI = new Set(["\u{1F44D}", "❤️", "\u{1F525}", "\u{1F4AF}", "✅"]);
// Thumbs-down, cross mark.
const NEGATIVE_EMOJI = new Set(["\u{1F44E}", "❌"]);

function sentiment(emojiName: string): string {
  if (POSITIVE_EMOJI.has(emojiName)) return "true";
  if (NEGATIVE_EMOJI.has(emojiName)) return "false";
  return "unknown";
}

/**
 * Reaction-driven feedback on bot turn replies. The turn-message lookup is also
 * the bot-authored filter: only finalized turn replies are indexed, so a miss
 * means the reaction targets some other message — no Discord fetch needed to
 * decide. On a hit it emits an `ai.feedback` metric (emoji + sentiment) and a
 * wide event joinable to the turn's trace and conversation.
 *
 * Bot reactions are already filtered upstream: the gateway's `reactionAdd` bind
 * (`protocol/events/reactions.ts`) early-returns on `user.bot` before
 * publishing, so they never reach here.
 */
export function createFeedbackHandler(turnMessages?: TurnMessageStore) {
  return defineEvent({
    type: "reactionAdd",
    async handle(packet) {
      const store = turnMessages ?? new TurnMessageStore();
      const turn = await store.get(packet.data.messageId);
      if (!turn) return;

      const emoji = packet.data.emoji.name;
      const positive = sentiment(emoji);
      countMetric("ai.feedback", { emoji, positive });
      // Raw user_id is fine on wide events; it is only forbidden in metric attributes.
      createWideLogger({ op: "ai.feedback" }).emit({
        message_id: packet.data.messageId,
        emoji,
        positive,
        user_id: packet.data.creator.id,
        chat_id: turn.chatId,
        trace_id: turn.traceId,
      });
    },
  });
}

export const feedback = createFeedbackHandler();
