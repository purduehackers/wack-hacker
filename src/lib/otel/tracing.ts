import {
  SpanStatusCode,
  context as otelContext,
  propagation,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

import { TRACER_NAME } from "./constants.ts";

export const tracer = trace.getTracer(TRACER_NAME);

/**
 * Run `fn` inside a span. Exceptions are recorded on the span, and the span
 * ends in the finally. Returns whatever `fn` returns.
 *
 * Mirrors the minimal pattern used across the codebase: open span, do work,
 * close span — no bespoke wrapper semantics.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Set attributes on whatever span is currently active. No-op if none. */
export function setActiveSpanAttributes(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

/**
 * Serialize the currently active OTEL context into a W3C `traceparent` string.
 * Returns undefined when there is no active span to serialize.
 *
 * Used to smuggle a span's context across execution boundaries that OTEL
 * cannot cross on its own — workflow `start(...)`, `resumeHook(...)` payloads,
 * and anywhere a child unit of work runs in a separate process / sandbox
 * without a live parent context. Pair with `withSpanFromParent` on the far
 * side to re-enter the same trace.
 */
export function captureTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier);
  return carrier.traceparent;
}

/**
 * Like `withSpan`, but if `traceparent` is provided, extracts it and runs the
 * new span as a child of that context. Falls back to a root span when
 * `traceparent` is absent or malformed.
 */
export async function withSpanFromParent<T>(
  traceparent: string | undefined,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  if (!traceparent) return withSpan(name, attributes, fn);
  const parentCtx = propagation.extract(otelContext.active(), { traceparent });
  return otelContext.with(parentCtx, () => withSpan(name, attributes, fn));
}
