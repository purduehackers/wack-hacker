import type { RequestLogger } from "evlog";

import type { InstrumentedArgs } from "./types.ts";

import { createWideLogger } from "../logging/wide.ts";
import { withSpan, withSpanFromParent } from "./tracing.ts";

export type { InstrumentedArgs } from "./types.ts";

/**
 * Run `fn` inside an OTEL span with a paired wide-event logger. The helper
 * wires up the three repeating concerns across workflow steps, route
 * handlers, and cron handlers:
 *
 *   1. Open a span via `withSpan` (or `withSpanFromParent` when a
 *      `traceparent` is provided).
 *   2. Build a `createWideLogger` scoped to `op` + `loggerContext`, pass it to
 *      `fn` so the caller can accumulate context via `.set()` / `.info()`.
 *   3. Emit a single terminal wide event on the way out — `outcome: "ok"`
 *      plus `duration_ms` on success, or `outcome: "error"` plus
 *      `duration_ms` + error class/message on failure.
 *
 * Metric emission (`countMetric`, `recordDuration`) stays in the caller —
 * metric names and tag sets vary too much per site for a one-size helper to
 * capture without leaky options.
 *
 * @example
 *   await runInstrumented(
 *     {
 *       op: "workflow.task.persist",
 *       spanAttrs: { "task.id": meta.id },
 *       loggerContext: { task: { id: meta.id } },
 *     },
 *     async () => {
 *       await saveTask(meta);
 *       countMetric("workflow.task.persisted", { schedule_type: meta.schedule.type });
 *     },
 *   );
 */
export async function runInstrumented<T>(
  args: InstrumentedArgs,
  fn: (logger: RequestLogger) => Promise<T>,
): Promise<T> {
  const { op, spanAttrs = {}, loggerContext, traceparent } = args;
  const body = async (): Promise<T> => {
    const logger = createWideLogger({ op, ...loggerContext });
    const startTime = Date.now();
    try {
      const result = await fn(logger);
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
      return result;
    } catch (err) {
      const error = err as Error;
      logger.error(error);
      logger.emit({
        outcome: "error",
        duration_ms: Date.now() - startTime,
        error_class: error.name,
        error_message: error.message,
      });
      throw err;
    }
  };
  return traceparent
    ? withSpanFromParent(traceparent, op, spanAttrs, body)
    : withSpan(op, spanAttrs, body);
}
