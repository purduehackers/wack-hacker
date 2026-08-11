import { UserRole } from "@repo/shared/discord";
import { serializeError } from "@repo/shared/errors";
import { Transient } from "@repo/shared/errors";
import { getRedis, type RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import { env, tursoConfig } from "../../env.ts";
const PUBLIC_DAILY_TOKEN_LIMIT = 250_000;
const TTL_SECONDS = 48 * 60 * 60;

function budgetKey(userId: string, now: Date): string {
  return `budget:tokens:${now.toISOString().slice(0, 10)}:${userId}`;
}

/** Redis-backed token budget. Callers may fail open only when this store returns Err. */
export class BudgetStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async read(userId: string): Promise<Result<BudgetState, Transient>> {
    const now = new Date();
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

  async add(userId: string, tokens: number): Promise<Result<BudgetState, Transient>> {
    const now = new Date();
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

import { ApprovalPolicyStore } from "./approval-record.ts";
import type { AuditStore } from "./audit.ts";
import type { BudgetState, PolicyEvaluationContext, PolicyPrincipal } from "./types.ts";

let redisStores:
  | {
      readonly approval: ApprovalPolicyStore;
      readonly budget: BudgetStore;
    }
  | undefined;
let auditStore: Promise<AuditStore> | undefined;

function stores() {
  if (redisStores !== undefined) return redisStores;
  const redis = getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  redisStores = {
    approval: new ApprovalPolicyStore(redis),
    budget: new BudgetStore(redis),
  };
  return redisStores;
}

export function getApprovalPolicyStore(): ApprovalPolicyStore {
  return stores().approval;
}

export function getBudgetStore(): BudgetStore {
  return stores().budget;
}

/** Defer libSQL until an action needs an audit row. */
export function getAuditStore(): Promise<AuditStore> {
  auditStore ??= import("./audit.ts").then(({ AuditStore }) => new AuditStore(tursoConfig()));
  return auditStore;
}

/**
 * The budget half of a policy evaluation context, read fail-open.
 *
 * Two rules live here rather than at each call site. Only `public` principals
 * are budgeted, so a higher role skips the Redis round trip entirely — the
 * engine's `withinBudget` returns true for them regardless of what was read.
 * And the budget backend is the policy spine's sole fail-open dependency: an
 * unavailable store yields an empty context, never a denial.
 */
export async function readBudgetContext(
  principal: PolicyPrincipal,
  label: string,
): Promise<PolicyEvaluationContext> {
  if (principal.role !== UserRole.Public) return {};
  const budget = await getBudgetStore().read(principal.userId);
  if (Result.isError(budget)) {
    console.warn(`${label} budget lookup unavailable`, serializeError(budget.error));
    return {};
  }
  return { budget: budget.value };
}
