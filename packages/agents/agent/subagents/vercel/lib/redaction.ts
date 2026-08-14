/**
 * @fileoverview Redaction helpers for SDK payloads that carry secrets inline.
 *
 * Three Vercel products return secrets inside otherwise-useful payloads.
 * Dropping the secret key (rather than masking it) keeps the credential out
 * of the serialized tool output entirely, so nothing can leak into Discord
 * or logs.
 */

import { z } from "zod";

/**
 * Any non-array object payload. The branch above the check handles arrays, so
 * `looseObject` is exactly the "walkable record" case. It keeps every key,
 * which is the point: the walk only removes the one named key.
 */
const objectPayload = z.looseObject({});

/**
 * Recursively drop every property named `key` from an SDK payload, walking
 * arrays and plain objects. Dropping (rather than masking) keeps the secret out
 * of the serialized tool output entirely.
 */
function dropKeyDeep(input: unknown, key: string): unknown {
  if (Array.isArray(input)) return input.map((item) => dropKeyDeep(item, key));
  const asObject = objectPayload.safeParse(input);
  if (asObject.success) {
    return Object.fromEntries(
      Object.entries(asObject.data)
        .filter(([entryKey]) => entryKey !== key)
        .map(([entryKey, entryValue]) => [entryKey, dropKeyDeep(entryValue, key)] as const),
    );
  }
  return input;
}

/**
 * Vercel renamed Edge Config to Global Config, but `@vercel/sdk` 1.19.40 still
 * exposes the accessor as `edgeConfig` with `*EdgeConfig*` method and parameter
 * names. Those are upstream identifiers, so they stay as they are. Every name
 * this domain owns — tools, inputs, descriptions — uses the current product
 * name.
 *
 * Strip the secret `token` field from Global Config token payloads. The Vercel
 * SDK returns raw tokens on list/get/create. Surfacing those into Discord or
 * logs would leak credentials. The SDK explicitly documents the `id` field as
 * a non-secret reference, so it stays along with label/createdAt.
 */
export function redactTokens(input: unknown): unknown {
  return dropKeyDeep(input, "token");
}

/** Strip `value` from env var payloads. The Vercel SDK may return plaintext for `plain` scope. */
export function redactEnvValues(input: unknown): unknown {
  return dropKeyDeep(input, "value");
}
