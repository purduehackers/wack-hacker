import { Redis } from "@upstash/redis";

import type { RedisLike } from "@/bot/types";

const THREAD_SLUG_TTL_SECONDS = 14 * 24 * 60 * 60;

export function generateEventSlug(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `hack-night-${y}-${m}-${d}`;
}

export class HackNightThreadStore {
  private redis: RedisLike;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? Redis.fromEnv();
  }

  private key(threadId: string): string {
    return `hack-night-thread:${threadId}`;
  }

  async set(threadId: string, slug: string): Promise<void> {
    await this.redis.set(this.key(threadId), slug, { ex: THREAD_SLUG_TTL_SECONDS });
  }

  async get(threadId: string): Promise<string | null> {
    return this.redis.get<string>(this.key(threadId));
  }
}

export async function resolveEventSlug(
  threadId: string,
  fallback: Date,
  store?: HackNightThreadStore,
): Promise<string> {
  const s = store ?? new HackNightThreadStore();
  const existing = await s.get(threadId);
  return existing ?? generateEventSlug(fallback);
}
