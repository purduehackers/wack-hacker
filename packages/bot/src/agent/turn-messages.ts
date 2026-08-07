/**
 * Reading the index of agent replies.
 *
 * The bot's paint layer records every finalized reply under
 * `turn-message:<messageId>` when a turn completes. The bot reads it to decide
 * whether a reaction landed on an agent reply.
 *
 * That lookup *is* the filter. Only finalized agent replies are indexed, so a
 * miss means the reaction was on something else — no Discord fetch is needed to
 * work that out, which matters because reactions are frequent and most of them
 * have nothing to do with the agent.
 *
 * The bot paint coordinator is the sole writer; reaction handlers only read.
 */

import { Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

const TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TurnMessage {
  /** The durable session the reply belongs to. */
  readonly sessionId: string;
  /** Joins feedback to the exact Eve turn. */
  readonly eveTurnId: string;
  /** Only this requester or a current organizer may end the conversation. */
  readonly requesterUserId: string;
}

export function turnMessageKey(messageId: string): string {
  return `turn-message:${messageId}`;
}

/**
 * Looks up the turn a message belongs to.
 *
 * A malformed or expired entry is indistinguishable from a miss here, and both
 * mean the same thing to the caller: this is not a reply we can attribute.
 */
export function createTurnMessageStore(redis: RedisClient) {
  return {
    get: async (messageId: string): Promise<TurnMessage | undefined> => {
      const raw = await redis
        .get<Record<string, unknown>>(turnMessageKey(messageId))
        .catch(() => undefined);

      // oxlint-disable-next-line unicorn/no-null -- Upstash reports a missing key as null
      if (raw === null || raw === undefined) return undefined;

      const sessionId = raw["sessionId"];
      const eveTurnId = raw["eveTurnId"];
      const requesterUserId = raw["requesterUserId"];
      if (
        typeof sessionId !== "string" ||
        typeof eveTurnId !== "string" ||
        typeof requesterUserId !== "string"
      ) {
        return undefined;
      }

      return { sessionId, eveTurnId, requesterUserId };
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
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  };
}

export type TurnMessageStore = ReturnType<typeof createTurnMessageStore>;
export type TurnMessageReader = Pick<TurnMessageStore, "get">;
export type TurnMessageWriter = Pick<TurnMessageStore, "record">;
