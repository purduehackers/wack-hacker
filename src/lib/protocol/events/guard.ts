import { log } from "evlog";

import { countMetric } from "@/lib/metrics";

/**
 * discord.js does not await listeners, so a rejection inside one is an
 * unhandled rejection and the event is silently lost. Every table-bound
 * listener body runs through this guard so one bad event is logged and counted
 * instead of taking down the relay.
 */
export function guardEvent(event: string, run: () => Promise<void>): Promise<void> {
  return run().catch((err) => {
    countMetric("gateway.handler_error", { event });
    log.error("gateway", `${event} handler error: ${String(err)}`);
  });
}
