import Exa from "exa-js";

import { env } from "../../../../env.ts";

/**
 * Shared Exa SDK client for the web search/contents tools.
 *
 * Lazily constructed so test suites that import `web_search` /
 * `web_get_contents` (transitively through the orchestrator) don't trip
 * Exa's eager `EXA_API_KEY` validation when `SKIP_ENV_VALIDATION=1` leaves
 * the key undefined. The first tool invocation in production builds
 * (where the key is set) returns a single cached instance so HTTP
 * keep-alive still applies.
 */
let cached: Exa | undefined;

export function getExa(): Exa {
  if (!cached) {
    cached = new Exa(env.EXA_API_KEY);
  }
  return cached;
}
