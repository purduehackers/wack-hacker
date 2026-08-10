import { z } from "zod";

/**
 * Any non-array object payload. Arrays are handled by the branch above the
 * check, so `looseObject` is exactly the "walkable record" case — and it keeps
 * every key, which is the point: the walk only removes the one named key.
 */
const objectPayload = z.looseObject({});

/**
 * Recursively drop every property named `key` from an SDK payload, walking
 * arrays and plain objects. Dropping (rather than masking) keeps the secret out
 * of the serialized tool output entirely.
 */
export function dropKeyDeep(input: unknown, key: string): unknown {
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
