import { z } from "zod";

import { digestPinnedImage } from "../formats.ts";
import { stored } from "../json.ts";
import type { RedisClient } from "../redis/client.ts";

/** Redis authority for the currently active bot Sandbox generation. */
export const BOT_ACTIVE_GENERATION_KEY = "wack:bot-sandbox:active:v1";
export const BOT_SUPERVISOR_MUTEX_KEY = "wack:bot-sandbox:supervisor:v1";
export const BOT_SUPERVISOR_FENCE_KEY = "wack:bot-sandbox:fence:v1";

/**
 * `abort` matters here: without it a value that is not a URL at all still
 * reaches the refinement, where `new URL` throws rather than failing the parse.
 */
const healthUrlSchema = z.url({ protocol: /^https$/u, abort: true }).refine((value) => {
  const url = new URL(value);
  return (
    url.pathname === "/health" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}, "expected an undecorated HTTPS /health URL");

/**
 * Canonical decoder for the fenced Redis record shared by every deployable.
 *
 * Deliberately not a `strictObject`: during a rolling promotion an older
 * deployable reads a record a newer supervisor wrote, and an unknown field must
 * not make the active generation undecodable.
 */
export const activeBotGenerationSchema = z.object({
  version: z.literal(1),
  generation: z.int().positive(),
  sandboxName: z.string().trim().min(1),
  commandId: z.string().trim().min(1),
  /** The requested immutable image reference, including its sha256 digest. */
  image: digestPinnedImage,
  healthUrl: healthUrlSchema,
  activatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /**
   * SHA-256 over the environment the container was started with.
   *
   * Optional because a record written before this field existed must stay
   * decodable — and because an absent fingerprint is exactly the signal to
   * replace: that sandbox was started with an environment nobody recorded.
   */
  envFingerprint: z.string().length(64).optional(),
});

export type ActiveBotGeneration = z.output<typeof activeBotGenerationSchema>;

/** Narrow read port projected directly from the Upstash owner. */
export type ActiveBotGenerationReader = Pick<RedisClient, "get">;

/** Decode either Upstash's already-deserialized JSON result or a raw JSON string. */
export function decodeActiveBotGeneration(raw: unknown): ActiveBotGeneration | undefined {
  if (raw === null || raw === undefined) return undefined;
  return stored(activeBotGenerationSchema).parse(raw);
}

export async function readActiveBotGeneration(
  redis: ActiveBotGenerationReader,
): Promise<ActiveBotGeneration | undefined> {
  return decodeActiveBotGeneration(await redis.get(BOT_ACTIVE_GENERATION_KEY));
}
