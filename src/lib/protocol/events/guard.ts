import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";

/**
 * discord.js does not await listeners, so a rejection inside one is an
 * unhandled rejection and the event is silently lost. Every table-bound
 * listener body runs through this guard so one bad event is counted and
 * captured (as a Sentry issue, not just a log) instead of taking down the relay.
 */
export function guardEvent(event: string, run: () => Promise<void>): Promise<void> {
  return run().catch((err) => {
    countMetric("gateway.handler_error", { event });
    const logger = createWideLogger({ op: "gateway.handler", event: { name: event } });
    logger.error(err as Error);
    logger.emit({ outcome: "error" });
  });
}
