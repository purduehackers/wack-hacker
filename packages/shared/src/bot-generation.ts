import { z } from "zod";

import type { RedisClient } from "./redis/client.ts";

/** Redis authority for the currently active bot Sandbox generation. */
export const BOT_ACTIVE_GENERATION_KEY = "wack:bot-sandbox:active:v1";
export const BOT_SUPERVISOR_MUTEX_KEY = "wack:bot-sandbox:supervisor:v1";
export const BOT_SUPERVISOR_FENCE_KEY = "wack:bot-sandbox:fence:v1";

const healthUrlSchema = z.url({ protocol: /^https$/u }).refine((value) => {
  const url = new URL(value);
  return (
    url.pathname === "/health" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}, "expected an undecorated HTTPS /health URL");

/** Canonical decoder for the fenced Redis record shared by every deployable. */
export const activeBotGenerationSchema = z.object({
  version: z.literal(1),
  generation: z.number().int().positive(),
  sandboxName: z.string().min(1),
  commandId: z.string().min(1),
  /** The requested immutable image reference, including its sha256 digest. */
  image: z.string().regex(/@sha256:[a-f0-9]{64}$/u),
  healthUrl: healthUrlSchema,
  activatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export type ActiveBotGeneration = z.output<typeof activeBotGenerationSchema>;

/** Narrow read port projected directly from the Upstash owner. */
export type ActiveBotGenerationReader = Pick<RedisClient, "get">;

/** Decode either Upstash's JSON result or the serialized form used by strict fakes. */
export function decodeActiveBotGeneration(raw: unknown): ActiveBotGeneration | undefined {
  if (raw === null || raw === undefined) return undefined;
  const decoded: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return activeBotGenerationSchema.parse(decoded);
}

export async function readActiveBotGeneration(
  redis: ActiveBotGenerationReader,
): Promise<ActiveBotGeneration | undefined> {
  return decodeActiveBotGeneration(await redis.get(BOT_ACTIVE_GENERATION_KEY));
}
