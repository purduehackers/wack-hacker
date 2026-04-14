import type { RedisLike } from "@/bot/types";

import { ConversationStore } from "@/bot/store";

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
