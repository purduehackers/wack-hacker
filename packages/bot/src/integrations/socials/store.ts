import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { RecoveryRequired, Transient } from "@repo/shared/errors";
import { stored } from "@repo/shared/json";
import type { RedisClient } from "@repo/shared/redis";
import { z } from "zod";

import { socialPostSchema } from "./types.ts";
import type { SocialSource } from "./types.ts";

export const SOCIALS_NAMESPACE = `socials:v1:${DISCORD_GUILD_ID}`;

const pendingSchema = z.object({
  post: socialPostSchema,
  attempts: z.int().nonnegative(),
  retryAt: z.number(),
  attemptedAt: z.number().optional(),
});
export const socialStateSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  baselineAt: z.number(),
  checkedAt: z.number(),
  pollRetryAt: z.number().default(0),
  knownIds: z.array(z.string()),
  pending: z.array(pendingSchema),
});
export type SocialState = z.output<typeof socialStateSchema>;

export interface SocialLease {
  readonly load: () => Promise<SocialState | undefined>;
  readonly save: (state: SocialState) => Promise<void>;
  readonly renew: () => Promise<void>;
}
export interface SocialStore {
  readonly run: (
    source: SocialSource,
    action: (lease: SocialLease) => Promise<void>,
  ) => Promise<boolean>;
}

const LEASE_MS = 120_000;
const SAVE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1`;
const RENEW = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

/** State has no TTL. Every write checks ownership of the source lease. */
export function createSocialStore(redis: RedisClient, namespace: string): SocialStore {
  return {
    run: async (source, action) => {
      const key = `${namespace}:${source.id}:${source.account}`;
      const lock = `${key}:lock`;
      const holder = crypto.randomUUID();
      if ((await redis.set(lock, holder, { nx: true, px: LEASE_MS })) !== "OK") return false;
      const check = (saved: unknown) => {
        if (saved !== 1)
          throw new Transient({
            operation: "socials state",
            detail: "lease expired; retry with current state",
          });
      };
      try {
        await action({
          load: async () => {
            const raw = (await redis.get<unknown>(key)) ?? undefined;
            if (raw === undefined) return undefined;
            const parsed = stored(socialStateSchema).safeParse(raw);
            if (!parsed.success || parsed.data.account !== source.account) {
              throw new RecoveryRequired({
                operation: `${source.id} state`,
                detail: "invalid stored baseline",
                remediation: "restore the state before enabling delivery",
              });
            }
            return parsed.data;
          },
          save: async (state) => {
            socialStateSchema.parse(state);
            check(await redis.eval(SAVE, [lock, key], [holder, JSON.stringify(state), LEASE_MS]));
          },
          renew: async () => {
            check(await redis.eval(RENEW, [lock], [holder, LEASE_MS]));
          },
        });
      } finally {
        // A failed release expires naturally; never hide the operation's error.
        await redis.eval(RELEASE, [lock], [holder]).catch(() => undefined);
      }
      return true;
    },
  };
}
