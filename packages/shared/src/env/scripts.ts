/**
 * Environment for the repository's operational scripts.
 *
 * Scripts run outside a deployment, so they read `process.env` directly rather
 * than through a package env schema. What they should not do is re-derive
 * "required" by hand at every entry point: a truthiness check accepts a URL
 * that is one typo away from talking to the wrong Redis, and it reports the
 * same sentence no matter which value is missing.
 *
 * Each accessor parses on call, not at import, so a script that never touches
 * Redis never demands Redis credentials.
 */

import { z } from "zod";

const redisEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/u }),
});

/** Native Redis connection URL, including TLS and ACL credentials. */
export function redisEnv(): { readonly url: string } {
  const parsed = redisEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid Redis environment:\n${z.prettifyError(parsed.error)}`);
  }
  return { url: parsed.data.REDIS_URL };
}

const tursoEnvSchema = z.object({
  /** Not a `z.url()`: libsql also accepts `file:` and bare local paths. */
  TURSO_DATABASE_URL: z.string().min(1),
  /** Absent when running against a local file; an empty value means the same. */
  TURSO_AUTH_TOKEN: z.string().min(1).optional().catch(undefined),
});

/** Turso connection settings; `authToken` stays absent for local databases. */
export function tursoEnv(): { readonly url: string; readonly authToken: string | undefined } {
  const parsed = tursoEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid Turso environment:\n${z.prettifyError(parsed.error)}`);
  }
  return { url: parsed.data.TURSO_DATABASE_URL, authToken: parsed.data.TURSO_AUTH_TOKEN };
}
