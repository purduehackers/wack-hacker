/**
 * Reading the index of agent replies.
 *
 * The bot's paint layer records every finalized reply under
 * `turn-message:<messageId>` when a turn completes. The bot reads it to decide
 * whether a reaction landed on an agent reply.
 *
 * That lookup *is* the filter. The index holds only finalized agent replies,
 * so a miss means the reaction was on something else. The bot needs no Discord
 * fetch to work that out. That matters because reactions are frequent and most
 * of them have nothing to do with the agent.
 *
 * The bot paint coordinator is the sole writer. Reaction handlers only read.
 */

import { messageOf, Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { z } from "zod";

const TTL_SECONDS = 7 * 24 * 60 * 60;

interface TurnMessage {
  /** The durable session the reply belongs to. */
  readonly sessionId: string;
  /** Joins feedback to the exact Eve turn. */
  readonly eveTurnId: string;
  /** Only this requester or a current organizer may end the conversation. */
  readonly requesterUserId: string;
}

/** The stored entry, field for field. Anything else reads as a miss. */
const turnMessageSchema = z.object({
  sessionId: z.string(),
  eveTurnId: z.string(),
  requesterUserId: z.string(),
});

function turnMessageKey(messageId: string): string {
  return `turn-message:${messageId}`;
}

/**
 * Looks up the turn a message belongs to.
 *
 * A malformed or expired entry is indistinguishable from a miss here. Both
 * mean the same thing to the caller: this is not a reply we can attribute.
 */
export function createTurnMessageStore(redis: RedisClient) {
  return {
    get: async (messageId: string): Promise<TurnMessage | undefined> => {
      // Upstash reports a missing key as null and a decode failure as a throw.
      // The schema rejects both alongside a malformed entry.
      const raw = await redis.get(turnMessageKey(messageId)).catch(() => undefined);
      const parsed = turnMessageSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    },

    record: async (messageId: string, turn: TurnMessage): Promise<Result<undefined, Transient>> =>
      Result.tryPromise({
        try: async () => {
          await redis.set(turnMessageKey(messageId), turn, { ex: TTL_SECONDS });
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "turn-message.record",
            detail: messageOf(cause),
          }),
      }),
  };
}

type TurnMessageStore = ReturnType<typeof createTurnMessageStore>;
export type TurnMessageReader = Pick<TurnMessageStore, "get">;
export type TurnMessageWriter = Pick<TurnMessageStore, "record">;
