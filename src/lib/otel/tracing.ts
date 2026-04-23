import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

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
