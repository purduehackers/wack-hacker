/**
 * Upstash hands a value back as JSON text or as the value itself.
 *
 * Which one you get depends on how it was written and on what the REST client
 * decided to parse, and both are normal. A reader that assumes either shape
 * works until it meets the other: assuming text rejects everything the client
 * already parsed, and assuming a value rejects everything it did not.
 *
 * This normalises the two into one, and stops there. It deliberately does not
 * validate — the decoder that owns the shape does that, immediately, at the one
 * call site. A helper that returned a validated-but-unknown value would be the
 * deferred-validation escape hatch this codebase bans elsewhere.
 */

import { z } from "zod";

export function redisValue(raw: unknown): unknown {
  const text = z.string().safeParse(raw);
  if (!text.success) return raw;
  try {
    return JSON.parse(text.data);
  } catch {
    // Not JSON: hand back the string. A plain string value is legitimate —
    // `agent:render-outcome` holds one — and the caller's schema will reject it
    // if that is not what belongs here.
    return text.data;
  }
}
