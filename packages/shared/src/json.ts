/**
 * JSON at the Redis boundary.
 *
 * Upstash returns a value either as JSON text or already deserialized. The
 * shape depends on how the writer stored it and which client wrote it, so
 * both shapes have to decode. A codec keeps the two directions in one
 * declaration:
 *
 * - `stored(schema)` reads either form,
 * - `z.encode(jsonCodec(schema), value)` produces exactly the text that
 *   reads back.
 *
 * The same schema checks the encode half, so no writer can produce a record
 * in a shape its own reader rejects.
 */

import { z } from "zod";

/** JSON text ⇄ a value of `schema`. */
export function jsonCodec<S extends z.ZodType>(schema: S): z.ZodCodec<z.ZodString, S> {
  // oxlint-disable-next-line rayhanadev/no-json-parse-stringify-codec -- the schema argument validates whatever decode parses at this Redis boundary
  return z.codec(z.string(), schema, {
    decode: (text, payload): z.input<S> => {
      try {
        return JSON.parse(text);
      } catch (cause) {
        payload.issues.push({
          code: "invalid_format",
          format: "json",
          input: text,
          message: cause instanceof Error ? cause.message : "value was not valid JSON",
        });
        return z.NEVER;
      }
    },
    encode: (value) => JSON.stringify(value),
  });
}

/** A record read back from Redis: JSON text, or the value itself. */
export function stored<S extends z.ZodType>(
  schema: S,
): z.ZodUnion<[z.ZodCodec<z.ZodString, S>, S]> {
  return z.union([jsonCodec(schema), schema]);
}
