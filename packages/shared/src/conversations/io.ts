/**
 * The three things every reader and writer here does to Redis.
 *
 * Upstash hands a value back as JSON text or as the value itself, depending on
 * how it was written and what the REST client decided to parse. Both are normal,
 * and a reader that assumes either one works until it meets the other.
 */

import { z } from "zod";

import { InvalidInput } from "../errors.ts";
import { stored } from "../json.ts";
import type { RedisClient } from "../redis/client.ts";
import { Result } from "../result/index.ts";

/**
 * Normalise the two shapes into one, without validating.
 *
 * For callers whose decoder lives in `wire.ts` and already returns a `Result`.
 * Everything else should use `decodeStored`, which does both halves at once.
 */
export function redisValue(raw: unknown): unknown {
  const text = z.string().safeParse(raw);
  if (!text.success) return raw;
  try {
    return JSON.parse(text.data);
  } catch {
    // A plain string value is legitimate — `agent:render-outcome` holds one —
    // and the caller's schema rejects it if that is not what belongs here.
    return text.data;
  }
}

/** Read a record back through the schema that owns it. Absent is not an error. */
export function decodeStored<S extends z.ZodType>(
  schema: S,
  subject: string,
  raw: unknown,
): Result<z.output<S> | undefined, InvalidInput> {
  if (raw === null || raw === undefined) return Result.ok(undefined);
  const parsed = stored(schema).safeParse(raw);
  if (parsed.success) return Result.ok(parsed.data);
  return Result.err(
    new InvalidInput({
      subject,
      issues: parsed.error.issues.map(({ message, path }) => `${path.join(".")}: ${message}`),
    }),
  );
}

/** Run a script whose whole answer is "did it happen". */
export async function evalFlag(
  redis: Pick<RedisClient, "eval">,
  script: string,
  keys: readonly string[],
  argv: readonly (string | number)[],
): Promise<boolean> {
  return Number(await redis.eval(script, [...keys], [...argv])) === 1;
}
