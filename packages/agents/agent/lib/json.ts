import { z } from "zod";

import type { JsonValue } from "./serialization.ts";

const MAX_DEPTH = 8;

/**
 * Everything `Object.entries` must not be walked into: the primitives plus functions.
 * `z.number()` rejects `NaN` and both infinities even though they are numbers, so
 * `z.nan()` and the two infinity comparisons restore the full number domain.
 */
const OPAQUE = z.union([
  z.string(),
  z.number(),
  z.nan(),
  z.boolean(),
  z.bigint(),
  z.symbol(),
  z.function(),
]);

function isOpaque(value: unknown): boolean {
  return (
    OPAQUE.safeParse(value).success ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY
  );
}

/** Redaction budget. Caps and key pattern differ per boundary and are deliberate. */
export interface RedactionLimits {
  readonly sensitiveKey: RegExp;
  readonly maxArrayItems: number;
  readonly maxEntries: number;
}

/** Build the depth-, breadth- and key-capped redactor used at a single boundary. */
export function createRedactor(limits: RedactionLimits): (value: unknown) => unknown {
  const redact = (value: unknown, key: string, depth: number): unknown => {
    if (limits.sensitiveKey.test(key)) return "[redacted]";
    if (depth >= MAX_DEPTH) return "[truncated]";
    if (Array.isArray(value)) {
      return value.slice(0, limits.maxArrayItems).map((item) => redact(item, "", depth + 1));
    }
    if (value === null || value === undefined) return value;
    if (isOpaque(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limits.maxEntries)
        .map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey, depth + 1)]),
    );
  };
  return (value) => redact(value, "", 0);
}

const redactJson = createRedactor({
  sensitiveKey:
    /authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key|^value$/iu,
  maxArrayItems: 100,
  maxEntries: 200,
});

/** Convert an integration result to a redacted, clone-free JSON value at the Eve boundary. */
export function plainJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(redactJson(value));
  if (serialized === undefined) return "[unserializable]";
  return JSON.parse(serialized);
}

/** Audit previews are JSON stored as text; a malformed row fails closed. */
export function redactAuditPreview(preview: string): string {
  try {
    return JSON.stringify(plainJson(JSON.parse(preview)));
  } catch {
    return "[redacted malformed audit preview]";
  }
}
