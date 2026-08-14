/**
 * Zod building blocks for this package's boundaries.
 *
 * `@repo/shared` declares the named string format and the JSON codec once,
 * because the bot writes the same durable records this package reads. A
 * second copy here would let the two sides drift apart silently. This module
 * re-exports them rather than importing them directly at each site, so the
 * package keeps one obvious home for its schema primitives.
 *
 * What is genuinely local lives below. Redis hands an integer counter back
 * as either a number or the decimal text from the original write. Only this
 * package reads those counters.
 */

import { z } from "zod";

export { discordSnowflake } from "@repo/shared/formats";
export { jsonCodec, stored as storedJson } from "@repo/shared/json";

/** Decimal text on one side, a safe integer on the other. */
export const stringToInt = z.codec(z.string().regex(z.regexes.integer), z.int(), {
  decode: (text) => Number.parseInt(text, 10),
  encode: (value) => value.toString(),
});

/** Redis returns a stored counter as a number or as the decimal text from the original write. */
export const storedInt = z.union([z.int(), stringToInt]);
