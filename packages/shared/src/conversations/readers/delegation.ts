/** Reads of what a delivery is waiting on. Never writes. */

import { InvalidInput } from "../../errors.ts";
import { stored } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import { subagentKey } from "../keys.ts";
import type { Delegation } from "../records/delegation.ts";
import { delegationSchema } from "../records/delegation.ts";

const storedDelegation = stored(delegationSchema);

export class DelegationReader {
  private readonly redis: Pick<RedisClient, "get">;

  constructor(redis: Pick<RedisClient, "get">) {
    this.redis = redis;
  }

  /** The child session this delivery is waiting on, if any. */
  async current(dispatchId: string): Promise<Result<Delegation | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(subagentKey(dispatchId));
    if (raw === null || raw === undefined) return Result.ok(undefined);
    const parsed = storedDelegation.safeParse(raw);
    return parsed.success
      ? Result.ok(parsed.data)
      : Result.err(
          new InvalidInput({
            subject: "subagent delegation",
            issues: parsed.error.issues.map(({ message, path }) => `${path.join(".")}: ${message}`),
          }),
        );
  }
}
