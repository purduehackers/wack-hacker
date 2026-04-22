import type { RedisLike } from "@/bot/types";

import { ConversationStore } from "@/bot/store";

import type { RichMemoryRedis, RichMemoryRedisPipeline } from "../types";

export function createMemoryRedis(): RedisLike {
  const data = new Map<string, { value: unknown; expiresAt?: number }>();

  return {
    get: async <T>(key: string): Promise<T | null> => {
      const entry = data.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        data.delete(key);
        return null;
      }
      return entry.value as T;
    },
    set: async (key: string, value: unknown, opts?: Record<string, unknown>) => {
      if (opts?.nx && data.has(key)) return null;
      const px = opts?.px as number | undefined;
      const ex = opts?.ex as number | undefined;
      const expiresAt = px ? Date.now() + px : ex ? Date.now() + ex * 1000 : undefined;
      data.set(key, { value, expiresAt });
      return "OK";
    },
    del: async (key: string) => {
      data.delete(key);
    },
    expire: async (key: string, seconds: number) => {
      const entry = data.get(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
    },
    eval: async (_script: string, evalKeys: string[], args: string[]) => {
      const entry = data.get(evalKeys[0]);
      if (entry && entry.value === args[0]) {
        data.delete(evalKeys[0]);
        return 1;
      }
      return 0;
    },
  };
}

export function memoryStore(): ConversationStore {
  return new ConversationStore(createMemoryRedis());
}

function buildPipeline(redis: RichMemoryRedis): RichMemoryRedisPipeline {
  const ops: Array<() => Promise<unknown>> = [];
  return {
    get(key: string): RichMemoryRedisPipeline {
      ops.push(() => redis.get(key));
      return this;
    },
    exec: async <T>(): Promise<T> => (await Promise.all(ops.map((fn) => fn()))) as T,
  };
}

/**
 * In-memory redis stub that covers the surface `@upstash/redis` exposes for
 * task registries and queues (sets + pipeline). Use when a test boots code
 * that calls `sadd` / `smembers` / `srem` / `pipeline()` — the smaller
 * `createMemoryRedis` (RedisLike) only covers key-value ops.
 */
export function createRichMemoryRedis(): RichMemoryRedis {
  const data = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();

  return {
    async get<T>(key: string): Promise<T | null> {
      return (data.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
      return "OK" as const;
    },
    async del(key: string) {
      // Match Upstash/Redis DEL semantics: return the number of keys removed.
      if (!data.has(key)) return 0;
      data.delete(key);
      return 1;
    },
    async sadd(key: string, ...members: string[]) {
      if (!sets.has(key)) sets.set(key, new Set());
      const set = sets.get(key)!;
      // Real Redis SADD returns the count of newly added members (duplicates
      // are not counted); mirror that so tests that assert on the return
      // value don't pass on the stub but fail in production.
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) {
          set.add(m);
          added++;
        }
      }
      return added;
    },
    async smembers<T>(key: string): Promise<T> {
      return [...(sets.get(key) ?? [])] as T;
    },
    async srem(key: string, ...members: string[]) {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const m of members) if (set.delete(m)) removed++;
      return removed;
    },
    pipeline(): RichMemoryRedisPipeline {
      return buildPipeline(this);
    },
    reset() {
      data.clear();
      sets.clear();
    },
  };
}
