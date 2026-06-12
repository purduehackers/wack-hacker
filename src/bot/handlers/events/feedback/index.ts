import { defineEvent } from "@/bot/events/define";
import { TurnMessageStore } from "@/bot/turn-message-store";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";

// Thumbs-up, red heart (with the variation selector, as Discord sends it), fire, 100, check.
const POSITIVE_EMOJI = new Set(["\u{1F44D}", "❤️", "\u{1F525}", "\u{1F4AF}", "✅"]);
// Thumbs-down, cross mark.
const NEGATIVE_EMOJI = new Set(["\u{1F44E}", "❌"]);

function sentiment(emojiName: string): string {
  if (POSITIVE_EMOJI.has(emojiName)) return "true";
  if (NEGATIVE_EMOJI.has(emojiName)) return "false";
  return "unknown";
}

/**
 * Reaction-driven feedback on bot turn replies. The turn-message lookup is
 * also the bot-authored filter: only finalized turn replies are indexed, so a
 * miss means the reaction targets some other message — no Discord fetch
 * needed to decide.
 */
export function createFeedbackHandler(turnMessages?: TurnMessageStore) {
  return defineEvent({
    type: "reactionAdd",
    async handle(packet) {
      if (packet.data.creator.bot) return;

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
        domains: turn.domains,
      });
    },
  });
}

export const feedback = createFeedbackHandler();
