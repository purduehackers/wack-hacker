/**
 * The only thing that writes delegations.
 *
 * Two transitions and no Lua: there is nothing to fence. A dispatch delegates to
 * one child at a time, and the writer is the agent — the same process, in the same
 * turn — so a second `begin` replacing the first is the intended behaviour rather
 * than a race to guard against.
 */

import { z } from "zod";

import { jsonCodec } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import { subagentKey } from "../keys.ts";
import type { Delegation } from "../records/delegation.ts";
import { DELEGATION_TTL_SECONDS, delegationSchema } from "../records/delegation.ts";

const delegationCodec = jsonCodec(delegationSchema);

export class DelegationWriter {
  private readonly redis: Pick<RedisClient, "set" | "del">;

  constructor(redis: Pick<RedisClient, "set" | "del">) {
    this.redis = redis;
  }

  /** Announce that this delivery is now waiting on a child session. */
  async begin(dispatchId: string, delegation: Delegation): Promise<void> {
    await this.redis.set(subagentKey(dispatchId), z.encode(delegationCodec, delegation), {
      ex: DELEGATION_TTL_SECONDS,
    });
  }

  /** The child returned; there is nothing left to follow. */
  async end(dispatchId: string): Promise<void> {
    await this.redis.del(subagentKey(dispatchId));
  }
}
