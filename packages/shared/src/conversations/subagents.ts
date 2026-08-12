/**
 * Which child session a delegated turn is waiting on.
 *
 * A declared subagent runs in its own session, and the parent's stream carries
 * only `subagent.called` and `subagent.completed` — the bookends. Everything
 * between happens on the child's own stream, which the parent cannot read
 * because it is suspended for exactly that span.
 *
 * This is how the child's address gets out to something that can read it. The
 * bot is a long-lived process holding a socket; the agent is not.
 */

import { z } from "zod";

import { InvalidInput } from "../errors.ts";
import { jsonText } from "../json.ts";
import type { RedisClient } from "../redis/client.ts";
import { Result } from "../result/index.ts";
import { subagentKey } from "./keys.ts";

/**
 * Shorter than the token it carries, deliberately.
 *
 * A Vercel OIDC token lives twelve hours. Bounding the record by the credential
 * rather than the other way round means a delegation can never outlive the
 * thing that makes it useful — a reader is never handed an address it has no
 * way to authenticate to. Cleared on completion regardless.
 */
const DELEGATION_TTL_SECONDS = 6 * 60 * 60;

const delegationSchema = z.strictObject({
  /** Address of the child's own event stream. */
  childSessionId: z.string().min(1).max(128),
  /** What to call it in the channel: "code", "github", … */
  name: z.string().min(1).max(64),
  /** Which call this is, so a second delegation replaces rather than duplicates. */
  callId: z.string().min(1).max(128),
  /**
   * Vercel OIDC token for reading the child's stream.
   *
   * Minted where the delegation is announced, because that runs in a Vercel
   * function and the reader does not: the bot is a long-lived sandbox process
   * with no Vercel identity of its own. Twelve hours covers any delegation, so
   * one mint serves the whole thing and there is no refresh path to get wrong.
   */
  streamToken: z.string().min(1).max(4_096),
  startedAt: z.iso.datetime(),
});

export type Delegation = z.output<typeof delegationSchema>;

export function createSubagentTransitions(redis: RedisClient) {
  return {
    /** Announce that this delivery is now waiting on a child session. */
    begin: async (dispatchId: string, delegation: Delegation): Promise<void> => {
      await redis.set(subagentKey(dispatchId), JSON.stringify(delegation), {
        ex: DELEGATION_TTL_SECONDS,
      });
    },

    /** The child returned; there is nothing left to follow. */
    end: async (dispatchId: string): Promise<void> => {
      await redis.del(subagentKey(dispatchId));
    },

    /** What this delivery is waiting on, if anything. */
    current: async (dispatchId: string): Promise<Result<Delegation | undefined, InvalidInput>> => {
      const raw: unknown = await redis.get(subagentKey(dispatchId));
      if (raw === null || raw === undefined) return Result.ok(undefined);
      const text = z.string().safeParse(raw);
      const decoded: unknown = text.success ? jsonText.parse(text.data) : raw;
      const parsed = delegationSchema.safeParse(decoded);
      return parsed.success
        ? Result.ok(parsed.data)
        : Result.err(
            new InvalidInput({
              subject: "subagent delegation",
              issues: parsed.error.issues.map((issue) => issue.message),
            }),
          );
    },
  };
}
