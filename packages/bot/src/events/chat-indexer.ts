/**
 * Reaction feedback on agent replies.
 *
 * A reaction on one of the agent's finished replies is the cheapest quality
 * signal available — the user gives it unprompted. The handler records it as a
 * wide event joinable to the turn's trace and session. A run of 👎 then traces
 * back to the turns that earned them.
 *
 * The turn-message lookup doubles as the "is this an agent reply?" filter: the
 * index only holds finalized replies, so a miss ends the handler with no
 * Discord fetch. Bot reactions never arrive here — the router drops them before
 * dispatch.
 *
 * This handler records. It does not notify the agent. Feedback is about turns
 * that are already over. Reopening a finished session to tell it someone gave
 * a thumbs-up would cost a model call for something nothing acts on.
 */

import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";

import type { TurnMessageReader } from "../agent/turn-messages.ts";
import { defineEvent } from "../framework/events.ts";

/** Thumbs-up, red heart with the variation selector Discord sends, fire, 100, check. */
const POSITIVE_EMOJI = new Set(["👍", "❤️", "🔥", "💯", "✅"]);

/** Thumbs-down, cross mark. */
const NEGATIVE_EMOJI = new Set(["👎", "❌"]);

type Sentiment = "positive" | "negative" | "unknown";

/**
 * Classifies a reaction.
 *
 * The handler records unrecognised emoji as `unknown` rather than dropping
 * them. What people actually react with is worth knowing, and guessing
 * sentiment from an arbitrary emoji would make the positive and negative
 * counts untrustworthy.
 */
function sentimentOf(emoji: string): Sentiment {
  if (POSITIVE_EMOJI.has(emoji)) return "positive";
  if (NEGATIVE_EMOJI.has(emoji)) return "negative";
  return "unknown";
}

export interface ChatIndexerDeps {
  readonly turnMessages: TurnMessageReader;
  readonly reporter: Reporter;
}

/**
 * Builds the reaction-feedback handler with its dependencies injected.
 *
 * The dedup key spans message, user, and emoji, so removing and re-adding the
 * same reaction still counts once.
 */
export function chatFeedback(deps: ChatIndexerDeps) {
  return defineEvent({
    name: "chat-feedback",
    kind: "reactionAdd",
    dedupKey: ({ reaction, user }) => `${reaction.message.id}:${user.id}:${reaction.emoji.name}`,
    handle: async ({ reaction, user }) => {
      const emoji = reaction.emoji.name;
      // discord.js reports a custom emoji with no name as null.
      if (emoji === null || emoji === undefined) return Result.ok(undefined);

      const turn = await deps.turnMessages.get(reaction.message.id);
      if (turn === undefined) return Result.ok(undefined);

      deps.reporter.emit({
        op: "ai.feedback",
        status: "ok",
        attributes: {
          emoji,
          sentiment: sentimentOf(emoji),
          messageId: reaction.message.id,
          userId: user.id,
          sessionId: turn.sessionId,
          eveTurnId: turn.eveTurnId,
        },
      });

      return Result.ok(undefined);
    },
  });
}
