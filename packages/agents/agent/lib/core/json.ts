import type { JsonValue } from "./serialization.ts";

const SENSITIVE_KEY =
  /authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key|^value$/iu;

function redact(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (depth >= 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, "", depth + 1));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 200)
      .map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey, depth + 1)]),
  );
}

/** Convert an integration result to a redacted, clone-free JSON value at the Eve boundary. */
export function plainJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(redact(value));
  if (serialized === undefined) return "[unserializable]";
  return JSON.parse(serialized);
}

/** Audit previews are JSON stored as text; malformed legacy rows fail closed. */
export function redactAuditPreview(preview: string): string {
  try {
    return JSON.stringify(plainJson(JSON.parse(preview)));
  } catch {
    return "[redacted malformed audit preview]";
  }
}
