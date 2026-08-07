import { BOT_ACTIVE_GENERATION_KEY, type ActiveBotGeneration } from "@repo/shared/bot-generation";
import type { RedisClient } from "@repo/shared/redis";
import { z } from "zod";

const activeBotGenerationSchema = z.strictObject({
  version: z.literal(1),
  generation: z.number().int().positive(),
  sandboxName: z.string().min(1),
  commandId: z.string().min(1),
  image: z.string().regex(/@sha256:[a-f0-9]{64}$/u),
  healthUrl: z
    .url({ protocol: /^https$/u })
    .refine((value) => new URL(value).pathname === "/health", "health URL must end in /health"),
  activatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<ActiveBotGeneration>;

/**
 * Resolve the fenced live Sandbox domain. A static host remains the fallback
 * for non-Sandbox deployments; malformed, unreadable, or expired active state
 * fails closed rather than routing work to a stale generation.
 */
export async function resolveBotBaseUrl(
  redis: RedisClient,
  fallback: string,
  now = new Date(),
): Promise<string> {
  const raw: unknown = await redis.get(BOT_ACTIVE_GENERATION_KEY);
  if (raw === null || raw === undefined) return fallback;
  let decoded: unknown = raw;
  if (typeof raw === "string") decoded = JSON.parse(raw);
  const active = activeBotGenerationSchema.parse(decoded);
  if (Date.parse(active.expiresAt) <= now.getTime()) {
    throw new Error("active bot Sandbox generation has expired");
  }
  const base = new URL(active.healthUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return base.toString();
}
