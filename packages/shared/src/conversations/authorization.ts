/** Private authorization-challenge records associated with a render dispatch. */

import type { RedisClient } from "../redis/client.ts";
import type { AuthorizationChallenge } from "../wire.ts";
import { authorizationChallengeKey, authorizationIndexKey } from "./keys.ts";

const STORE_AUTHORIZATION_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[2]))
redis.call("SADD", KEYS[2], KEYS[1])
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
return 1
`;

const DELETE_AUTHORIZATION_SCRIPT = `
redis.call("DEL", KEYS[1])
redis.call("SREM", KEYS[2], KEYS[1])
if redis.call("SCARD", KEYS[2]) == 0 then redis.call("DEL", KEYS[2]) end
return 1
`;

export function createAuthorizationTransitions(redis: Pick<RedisClient, "eval">) {
  return {
    store: async (
      dispatchId: string,
      authorizationId: string,
      challenge: AuthorizationChallenge,
      challengeTtlSeconds: number,
      indexTtlSeconds: number,
    ): Promise<void> => {
      await redis.eval(
        STORE_AUTHORIZATION_SCRIPT,
        [authorizationChallengeKey(dispatchId, authorizationId), authorizationIndexKey(dispatchId)],
        [JSON.stringify(challenge), challengeTtlSeconds, indexTtlSeconds],
      );
    },
    delete: async (dispatchId: string, authorizationId: string): Promise<void> => {
      await redis.eval(
        DELETE_AUTHORIZATION_SCRIPT,
        [authorizationChallengeKey(dispatchId, authorizationId), authorizationIndexKey(dispatchId)],
        [],
      );
    },
  };
}
