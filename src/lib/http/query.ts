/**
 * Stringify a value for use as a URL query parameter. Primitives coerce via
 * `String`, objects go through `JSON.stringify` so they don't render as
 * `[object Object]`, and null/undefined collapse to an empty string.
 */
export function stringifyQueryValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean | bigint);
}
