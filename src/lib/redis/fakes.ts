import type { RedisClient } from "./client";

interface MemoryPipeline {
  get(key: string): MemoryPipeline;
  exec<T>(): Promise<T>;
}

class MemoryPipelineImpl implements MemoryPipeline {
  private ops: Array<() => Promise<unknown>> = [];

  constructor(private source: Pick<RedisClient, "get">) {}

  get(key: string): MemoryPipeline {
    this.ops.push(() => this.source.get(key));
    return this;
  }

  async exec<T>(): Promise<T> {
    return (await Promise.all(this.ops.map((fn) => fn()))) as T;
  }
}

/**
 * In-memory fake that implements the full `RedisClient` surface. Use in tests
 * by passing as the constructor arg (`new ConversationStore(createMemoryRedis())`)
 * or wherever a `RedisClient` is expected. Exposes `reset()` for clearing
 * state between tests.
 */
export function createMemoryRedis(): RedisClient & { reset(): void } {
  const data = new Map<string, { value: unknown; expiresAt?: number }>();
  const sets = new Map<string, Set<string>>();

  const client = {
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
      return "OK" as const;
    },
    del: async (key: string) => {
      if (!data.has(key)) return 0;
      data.delete(key);
      return 1;
    },
    expire: async (key: string, seconds: number) => {
      const entry = data.get(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
      return Number(!!entry);
    },
    eval: async (_script: string, evalKeys: string[], args: unknown[]) => {
      // Single Lua script we use: compare-and-delete for lock release.
      const entry = data.get(evalKeys[0]);
      if (entry && entry.value === args[0]) {
        data.delete(evalKeys[0]);
        return 1;
      }
      return 0;
    },
    sadd: async (key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      const set = sets.get(key)!;
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) {
          set.add(m);
          added++;
        }
      }
      return added;
    },
    smembers: async <T>(key: string): Promise<T> => {
      return [...(sets.get(key) ?? [])] as T;
    },
    srem: async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const m of members) if (set.delete(m)) removed++;
      return removed;
    },
    pipeline: (): MemoryPipeline => new MemoryPipelineImpl(client),
    reset: () => {
      data.clear();
      sets.clear();
    },
  };

  return client as unknown as RedisClient & { reset(): void };
}
