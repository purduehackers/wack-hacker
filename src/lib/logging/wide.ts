import { trace } from "@opentelemetry/api";
import { createLogger, type RequestLogger } from "evlog";

type WideContext = Record<string, unknown>;

/**
 * Create a scoped wide-event logger for one unit of work. Wraps `evlog`'s
 * `createLogger` so:
 *   - The emitted event automatically includes the current OTEL trace id
 *     (`trace.id`), which Sentry uses to join a log line to a trace.
 *   - Base context (op, chat, user, workflow ids, …) is set once up front and
 *     flows through `.set()`, `.info()`, `.warn()`, `.error()`, and `.emit()`.
 *
 * Follow the wide-event pattern: create one logger per unit of work, accumulate
 * attributes as the work progresses (`.set({...})`), and call `.emit({status, duration_ms, ...})`
 * exactly once at the end. Errors should be captured with `.error(err)` before
 * the final emit; the wide event will carry both the accumulated context and
 * the parsed error fields.
 *
 * @example
 *   const logger = createWideLogger({ op: "chat.run_turn", chat: { id, channel_id } });
 *   logger.set({ turn_index: 2 });
 *   try {
 *     const turn = await streamTurn(...);
 *     logger.emit({ status: "ok", tokens: turn.usage.totalTokens });
 *   } catch (err) {
 *     logger.error(err as Error);
 *     logger.emit({ status: "error" });
 *     throw err;
 *   }
 */
export function createWideLogger(context: WideContext = {}): RequestLogger {
  const logger = createLogger(context);
  const originalEmit = logger.emit.bind(logger);
  // Re-assign emit via Object.assign so we preserve the RequestLogger shape
  // without casting; evlog's RequestLogger.emit accepts a plain object of
  // overrides, which matches what we splat in here.
  logger.emit = (overrides = {}) => {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    return originalEmit({
      ...(traceId ? { trace: { id: traceId } } : {}),
      ...overrides,
    });
  };
  return logger;
}
