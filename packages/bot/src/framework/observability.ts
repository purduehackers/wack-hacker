/**
 * Structured logging, tracing, and metrics for the long-running bot.
 *
 * The reporter counts and logs expected failures. Only defects become Sentry issues.
 * Metric dimensions deliberately exclude Discord/session identifiers so cardinality
 * stays bounded, while the wide JSON event retains those identifiers for diagnosis.
 */

import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import type { Attributes, Reporter, WideEvent } from "@repo/shared/result/observe";
import * as Sentry from "@sentry/bun";

/** Pure formatter for the wide event's one-line log form. */
function wideEventLine(event: WideEvent, traceId?: string): string {
  return JSON.stringify({
    ...event.attributes,
    event: "operation.completed",
    op: event.op,
    status: event.status,
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.errorTag === undefined ? {} : { errorTag: event.errorTag }),
    ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
    ...(traceId === undefined ? {} : { traceId }),
  });
}

/** One counter per terminal operation and one latency sample when available. */
function recordOperationMetrics(event: WideEvent): void {
  const attributes: Record<string, string> = { op: event.op, status: event.status };
  if (event.errorTag !== undefined) attributes["errorTag"] = event.errorTag;
  Sentry.metrics.count("bot.operation", 1, { attributes });
  if (event.durationMs !== undefined) {
    Sentry.metrics.distribution("bot.operation.duration", event.durationMs, {
      unit: "millisecond",
      attributes: { op: event.op, status: event.status },
    });
  }
}

/** W3C context used on durable bot→agent deliveries. */
export function activeTraceparent(): string | undefined {
  const span = trace.getSpan(context.active());
  if (span === undefined) return undefined;
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return undefined;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/** Restores a persisted W3C parent before starting the recovery consumer span. */
export function continueTrace<T>(traceparent: string | undefined, work: () => T): T {
  if (traceparent === undefined) return work();
  const match =
    /^(?!ff)[0-9a-f]{2}-((?!0{32})[0-9a-f]{32})-((?!0{16})[0-9a-f]{16})-([0-9a-f]{2})$/u.exec(
      traceparent,
    );
  if (match === null) return work();
  const [, traceId = "", spanId = "", flags = "00"] = match;
  const sampled = (Number.parseInt(flags, 16) & 1) === 1 ? "1" : "0";
  return Sentry.continueTrace(
    { sentryTrace: `${traceId}-${spanId}-${sampled}`, baggage: undefined },
    work,
  );
}

/** Ensures gateway and cron work has an active span before it crosses a durable seam. */
export function traceOperation<T>(op: string, work: () => T, attributes?: Attributes): T {
  return Sentry.startSpan(
    { name: op, op, ...(attributes === undefined ? {} : { attributes }) },
    work,
  );
}

function activeTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  return span === undefined ? undefined : Sentry.spanToJSON(span).trace_id;
}

export const consoleReporter: Reporter = {
  emit: (event) => {
    recordOperationMetrics(event);
    const line = wideEventLine(event, activeTraceId());
    if (event.status === "ok") console.info(line);
    else console.warn(line);
  },
  captureDefect: (error, context) => {
    // Defects keep their stack and are the only failures that create an issue.
    console.error(`defect op=${context.op}`, error);
    Sentry.withScope((scope) => {
      scope.setTag("operation", context.op);
      if (context.attributes !== undefined) scope.setAttributes(context.attributes);
      Sentry.captureException(error);
    });
  },
};
