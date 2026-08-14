/**
 * The only thing that writes authorization challenges.
 *
 * A challenge — an OAuth consent, a device code — lives here rather than in
 * agent state. The person clicks the button that resolves it in the bot
 * process, and the bot process cannot read agent state. The index exists so
 * cleanup can remove the pair together. A challenge key alone is unreachable
 * once the turn that knew its id is gone.
 */

import type { RedisClient } from "../../redis/client.ts";
import type { AuthorizationChallenge } from "../../wire.ts";
import { authorizationChallengeKey, authorizationIndexKey } from "../keys.ts";

/** How long the index outlives the challenges it points at. */
const INDEX_TTL_SECONDS = 60 * 60;

const STORE = `
-- authorization:store
redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[2]))
redis.call("SADD", KEYS[2], KEYS[1])
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
return 1
`;

const FORGET = `
-- authorization:forget
redis.call("DEL", KEYS[1])
redis.call("SREM", KEYS[2], KEYS[1])
if redis.call("SCARD", KEYS[2]) == 0 then redis.call("DEL", KEYS[2]) end
return 1
`;

/**
 * Owns the challenge keys and the per-dispatch index as one unit. Each Lua
 * script writes both together, so a crash cannot leave a challenge that no
 * index entry points at.
 */
export class AuthorizationWriter {
  private readonly redis: Pick<RedisClient, "eval">;

  constructor(redis: Pick<RedisClient, "eval">) {
    this.redis = redis;
  }

  /** `challengeTtlSeconds` comes from the challenge's own expiry, not ours. */
  async store(
    dispatchId: string,
    authorizationId: string,
    challenge: AuthorizationChallenge,
    challengeTtlSeconds: number,
  ): Promise<void> {
    await this.redis.eval(
      STORE,
      [authorizationChallengeKey(dispatchId, authorizationId), authorizationIndexKey(dispatchId)],
      [JSON.stringify(challenge), challengeTtlSeconds, INDEX_TTL_SECONDS],
    );
  }

  /** Drop a challenge the person has now answered. */
  async forget(dispatchId: string, authorizationId: string): Promise<void> {
    await this.redis.eval(
      FORGET,
      [authorizationChallengeKey(dispatchId, authorizationId), authorizationIndexKey(dispatchId)],
      [],
    );
  }
}
