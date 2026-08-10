import { z } from "zod";

const stringValue = z.string();
const symbolValue = z.symbol();
/** `z.number()` rejects NaN and the infinities, all of which `String` still renders. */
const stringifiableValue = z.union([z.number(), z.nan(), z.boolean(), z.bigint()]);
const functionValue = z.function();

/** Every value `String` renders as its own literal text rather than as JSON. */
function isStringifiable(value: unknown): value is number | boolean | bigint {
  return (
    stringifiableValue.safeParse(value).success ||
    Object.is(value, Number.POSITIVE_INFINITY) ||
    Object.is(value, Number.NEGATIVE_INFINITY)
  );
}

/**
 * Stringify a value for use as a URL query parameter. Primitives coerce via
 * `String`, objects go through `JSON.stringify` so they don't render as
 * `[object Object]`, and null/undefined collapse to an empty string. Functions
 * carry no query representation at all, so they collapse the same way.
 */
export function stringifyQueryValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const asString = stringValue.safeParse(value);
  if (asString.success) return asString.data;
  const asSymbol = symbolValue.safeParse(value);
  if (asSymbol.success) return asSymbol.data.description ?? "";
  if (isStringifiable(value)) return String(value);
  if (functionValue.safeParse(value).success) return "";
  // Once null, undefined and every primitive are excluded, only objects remain.
  return JSON.stringify(value);
}
