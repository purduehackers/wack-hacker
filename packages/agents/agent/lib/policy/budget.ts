import { Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import type { BudgetState } from "./types.ts";

export const PUBLIC_DAILY_TOKEN_LIMIT = 250_000;
const TTL_SECONDS = 48 * 60 * 60;

export function budgetKey(userId: string, now = new Date()): string {
  return `budget:tokens:${now.toISOString().slice(0, 10)}:${userId}`;
}

/** Redis-backed token budget. Callers may fail open only when this store returns Err. */
export class BudgetStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async read(userId: string, now = new Date()): Promise<Result<BudgetState, Transient>> {
    return Result.tryPromise({
      try: async () => {
        const raw: unknown = await this.redis.get(budgetKey(userId, now));
        const used = raw === null || raw === undefined ? 0 : Number(raw);
        if (!Number.isFinite(used) || used < 0) throw new Error("budget counter is invalid");
        return { used, limit: PUBLIC_DAILY_TOKEN_LIMIT };
      },
      catch: (cause) => new Transient({ operation: "read AI token budget", detail: String(cause) }),
    });
  }

  async add(
    userId: string,
    tokens: number,
    now = new Date(),
  ): Promise<Result<BudgetState, Transient>> {
    return Result.tryPromise({
      try: async () => {
        const increment = Math.max(0, Math.trunc(tokens));
        const key = budgetKey(userId, now);
        const used = Number(await this.redis.incrby(key, increment));
        await this.redis.expire(key, TTL_SECONDS);
        if (!Number.isFinite(used) || used < 0) throw new Error("budget counter is invalid");
        return { used, limit: PUBLIC_DAILY_TOKEN_LIMIT };
      },
      catch: (cause) =>
        new Transient({ operation: "record AI token usage", detail: String(cause) }),
    });
  }
}
