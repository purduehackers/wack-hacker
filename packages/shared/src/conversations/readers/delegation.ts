/** Reads of what a delivery is waiting on. Never writes. */

import type { InvalidInput } from "../../errors.ts";
import type { RedisClient } from "../../redis/client.ts";
import type { Result } from "../../result/index.ts";
import { decodeStored } from "../io.ts";
import { subagentKey } from "../keys.ts";
import type { Delegation } from "../records/delegation.ts";
import { delegationSchema } from "../records/delegation.ts";

export class DelegationReader {
  private readonly redis: Pick<RedisClient, "get">;

  constructor(redis: Pick<RedisClient, "get">) {
    this.redis = redis;
  }

  /** The child session this delivery is waiting on, if any. */
  async current(dispatchId: string): Promise<Result<Delegation | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(subagentKey(dispatchId));
    return decodeStored(delegationSchema, "subagent delegation", raw);
  }
}
