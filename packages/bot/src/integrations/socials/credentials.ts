import { RecoveryRequired, Transient } from "@repo/shared/errors";
import { stored } from "@repo/shared/json";
import type { RedisClient } from "@repo/shared/redis";
import { z } from "zod";

import { createInstagramClient } from "./sources/instagram.ts";
import type { SocialFetch } from "./types.ts";

const DAY_MS = 24 * 60 * 60_000;
export interface InstagramConfig {
  readonly accountId: string;
  readonly token: string;
}
const credentialSchema = z.object({
  revision: z.string(),
  token: z.string().min(1),
  refreshAt: z.number(),
  expiresAt: z.number().optional(),
});

const SAVE_REFRESH = `
local raw = redis.call('GET', KEYS[1])
if not raw or cjson.decode(raw).revision ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

export interface InstagramCredentials {
  readonly current: () => Promise<string>;
  readonly refresh: () => Promise<void>;
}

/** Redis holds the refreshed token across container restarts. Never log this record. */
export function createInstagramCredentials(options: {
  readonly redis: RedisClient;
  readonly namespace: string;
  readonly accountId: string;
  readonly bootstrapToken: string;
  readonly request?: SocialFetch;
}): InstagramCredentials {
  const key = `${options.namespace}:instagram:${options.accountId}:credential`;
  const seed = (): z.output<typeof credentialSchema> => ({
    revision: crypto.randomUUID(),
    token: options.bootstrapToken,
    refreshAt: Date.now() + 25 * 60 * 60_000,
  });
  const apiFor = (token: string) =>
    createInstagramClient({
      accountId: options.accountId,
      token: async () => token,
      request: options.request,
    });
  const load = async () => {
    const raw = (await options.redis.get<unknown>(key)) ?? undefined;
    if (raw === undefined) return seed();
    const parsed = stored(credentialSchema).safeParse(raw);
    if (!parsed.success) {
      throw new RecoveryRequired({
        operation: "Instagram credentials",
        detail: "stored credential is invalid",
        remediation: "replace the token following docs/plans/socials.md",
      });
    }
    return parsed.data;
  };
  return {
    current: async () => {
      const state = await load();
      if (state.expiresAt !== undefined && state.expiresAt <= Date.now()) {
        throw new RecoveryRequired({
          operation: "Instagram credentials",
          detail: "token expired",
          remediation: "replace the token following docs/plans/socials.md",
        });
      }
      return state.token;
    },
    refresh: async () => {
      await options.redis.set(key, JSON.stringify(seed()), { nx: true });
      const state = await load();
      if (state.refreshAt > Date.now()) return;
      const api = apiFor(state.token);
      await api.identity();
      const next = await api.refresh();
      const now = Date.now();
      const replacement = {
        revision: crypto.randomUUID(),
        token: next.token,
        refreshAt: now + Math.min(30 * DAY_MS, next.expiresIn * 500),
        expiresAt: now + next.expiresIn * 1_000,
      };
      const saved = await options.redis.eval(
        SAVE_REFRESH,
        [key],
        [state.revision, JSON.stringify(replacement)],
      );
      if (saved !== 1)
        throw new Transient({
          operation: "Instagram refresh",
          detail: "credential changed concurrently; using the latest stored token",
        });
    },
  };
}
