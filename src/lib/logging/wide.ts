import { trace } from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";
import { createLogger, type RequestLogger } from "evlog";

type WideContext = Record<string, unknown>;

/**
 * Create a scoped wide-event logger for one unit of work. Wraps `evlog`'s
 * `createLogger` so:
 *   - The emitted event automatically includes the current OTEL trace id
 *     (`trace.id`). evlog writes the event as JSON to stdout, where
 *     `Sentry.consoleLoggingIntegration` (sentry.server.config.ts) captures
 *     it into Sentry Logs; the injected trace.id joins the log line to its
 *     trace there.
 *   - `.error()` forwards the error to `Sentry.captureException` before
 *     delegating to evlog, so every call site gets a Sentry issue while the
 *     wide event still accumulates the parsed error fields. This is the one
 *     error-reporting path for the codebase — do not add bare
 *     `captureException` calls next to `logger.error`, that double-reports.
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
  const originalError = logger.error.bind(logger);
  logger.error = (error, errorContext) => {
    Sentry.captureException(error);
    originalError(error, errorContext);
  };
  return logger;
}
