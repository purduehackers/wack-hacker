/**
 * Environment for the repository's operational scripts.
 *
 * Scripts run outside a deployment, so they read `process.env` directly rather
 * than through a package env schema. What they should not do is re-derive
 * "required" by hand at every entry point. A truthiness check accepts a URL
 * that is one typo away from talking to the wrong Redis. It also reports the
 * same sentence no matter which of the two values is missing.
 *
 * Each accessor parses on call, not at import, so a script that never touches
 * Redis never demands Redis credentials.
 */

import { z } from "zod";

const redisEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url({ protocol: /^https?$/u }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

/** Upstash REST credentials, as `@upstash/redis` wants them. */
export interface RedisEnv {
  readonly url: string;
  readonly token: string;
}

/** Reads and validates the Upstash Redis credentials from `process.env`. */
export function redisEnv(): RedisEnv {
  const parsed = redisEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid Upstash Redis environment:\n${z.prettifyError(parsed.error)}`);
  }
  return { url: parsed.data.UPSTASH_REDIS_REST_URL, token: parsed.data.UPSTASH_REDIS_REST_TOKEN };
}

const tursoEnvSchema = z.object({
  /** Not a `z.url()`: libsql also accepts `file:` and bare local paths. */
  TURSO_DATABASE_URL: z.string().min(1),
  /** Absent when running against a local file. An empty value means the same. */
  TURSO_AUTH_TOKEN: z.string().min(1).optional().catch(undefined),
});

/** Turso connection settings. `authToken` stays absent for local databases. */
export interface TursoEnv {
  readonly url: string;
  readonly authToken: string | undefined;
}

/** Reads and validates the Turso connection settings from `process.env`. */
export function tursoEnv(): TursoEnv {
  const parsed = tursoEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid Turso environment:\n${z.prettifyError(parsed.error)}`);
  }
  return { url: parsed.data.TURSO_DATABASE_URL, authToken: parsed.data.TURSO_AUTH_TOKEN };
}
