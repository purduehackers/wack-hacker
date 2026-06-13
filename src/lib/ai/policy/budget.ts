import { log } from "evlog";

import type { RedisClient } from "@/lib/redis/client";

import { createRedis } from "@/lib/redis/client";

import type { BudgetState, PolicySubject } from "./types.ts";

import { UserRole } from "../constants.ts";
import { PUBLIC_DAILY_TOKEN_LIMIT } from "./constants.ts";
import { roleAtLeast } from "./decide.ts";

const KEY_PREFIX = "budget:tokens:";
const TTL_SECONDS = 48 * 60 * 60;

/** UTC day bucket so the counter resets at midnight UTC. */
function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Redis-backed daily token counter. `TurnUsageTracker` totals are folded in
 * at turn finalize; `decide()` reads the resulting state. The client is built
 * lazily so constructing a store never throws in environments without Redis.
 */
export class BudgetStore {
  constructor(private redis?: RedisClient) {}

  private client(): RedisClient {
    return (this.redis ??= createRedis());
  }

  private key(userId: string): string {
    return `${KEY_PREFIX}${dayKey()}:${userId}`;
  }

  async read(userId: string): Promise<number> {
    return (await this.client().get<number>(this.key(userId))) ?? 0;
  }

  async add(userId: string, tokens: number): Promise<void> {
    const key = this.key(userId);
    await this.client().incrby(key, tokens);
    // Unconditional EXPIRE: detecting "first write of the day" via the incrby
    // result races under concurrent adds and can leave the key TTL-less
    // forever. Refreshing on every write costs one extra command and
    // guarantees stale day buckets clean themselves up.
    await this.client().expire(key, TTL_SECONDS);
  }
}

/**
 * Without Upstash env, `Redis.fromEnv()` builds a client that fails each
 * command only after a multi-second internal retry loop. Skip the budget
 * dimension entirely when Redis is unconfigured (local dev, unit tests)
 * rather than paying that latency per turn.
 */
function defaultStore(): BudgetStore | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new BudgetStore();
}

/**
 * Resolve the budget dimension for a subject. Organizer+ are exempt (null);
 * Redis failures also resolve to null so an Upstash outage degrades to
 * "no budget enforcement", never to a locked-out bot.
 */
export async function readBudgetState(
  subject: PolicySubject,
  store?: BudgetStore,
): Promise<BudgetState | null> {
  if (roleAtLeast(subject.role, UserRole.Organizer)) return null;
  const resolved = store ?? defaultStore();
  if (!resolved) return null;
  try {
    const used = await resolved.read(subject.userId);
    return { used, limit: PUBLIC_DAILY_TOKEN_LIMIT };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    log.warn("policy", `Budget read failed for ${subject.userId}: ${message}`);
    return null;
  }
}

/** Best-effort fold of a finished turn's token total into the daily counter. */
export async function recordTurnTokens(
  userId: string,
  tokens: number,
  store?: BudgetStore,
): Promise<void> {
  if (tokens <= 0) return;
  const resolved = store ?? defaultStore();
  if (!resolved) return;
  try {
    await resolved.add(userId, tokens);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    log.warn("policy", `Budget increment failed for ${userId}: ${message}`);
  }
}
