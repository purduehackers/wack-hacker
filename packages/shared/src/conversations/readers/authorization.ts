/** Reads of the authorization challenges hanging off a dispatch. Never writes. */

import type { InvalidInput } from "../../errors.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import type { AuthorizationChallenge } from "../../wire.ts";
import { decodeAuthorizationChallenge } from "../../wire.ts";
import { redisValue } from "../io.ts";
import { authorizationChallengeKey } from "../keys.ts";

/**
 * Read-only view of the authorization challenges hanging off a dispatch.
 *
 * Built on Redis `get` alone, so nothing behind this class can extend, mutate,
 * or delete a challenge. An absent challenge is ordinary and decodes to
 * `undefined` rather than an error.
 */
export class AuthorizationReader {
  private readonly redis: Pick<RedisClient, "get">;

  constructor(redis: Pick<RedisClient, "get">) {
    this.redis = redis;
  }

  /**
   * The challenge behind one authorization button.
   *
   * Absent is ordinary: a challenge outlives neither its own expiry nor the
   * connection completing, so the caller tells the person it has gone stale.
   */
  async challenge(
    dispatchId: string,
    authorizationId: string,
  ): Promise<Result<AuthorizationChallenge | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(
      authorizationChallengeKey(dispatchId, authorizationId),
    );
    if (raw === null || raw === undefined) return Result.ok(undefined);
    return decodeAuthorizationChallenge(redisValue(raw));
  }
}
