/** @fileoverview Low-cardinality Sentry telemetry and W3C propagation for the Eve process. */

import * as Sentry from "@sentry/node";

export type TelemetryAttribute = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryAttribute>>;

/**
 * The Redis key that accumulates one turn's visible token count. The hook
 * writer and the Discord reader must derive it the same way, so both call
 * this instead of formatting the key inline.
 */
export function turnTokenKey(sessionId: string, turnId: string): string {
  return `agent:turn-tokens:${sessionId}:${turnId}`;
}

/**
 * The trace id of the active Sentry span, so logs and audit records can point
 * back to the trace that produced them. Returns `undefined` outside a span.
 */
export function currentTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  return span === undefined ? undefined : Sentry.spanToJSON(span).trace_id;
}

/**
 * The W3C `traceparent` for the active Sentry span, so an outbound request
 * joins the trace that produced it. Returns `undefined` outside a span, and
 * for all-zero trace or span ids, which the W3C format declares invalid.
 */
export function currentTraceparent(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (span === undefined) return undefined;
  const spanContext = span.spanContext();
  if (/^0{32}$/u.test(spanContext.traceId) || /^0{16}$/u.test(spanContext.spanId)) return undefined;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * Headers that carry trace continuity to the bot. An explicit traceparent
 * wins over the active span, and the empty object keeps callers spreading
 * this without a conditional when no trace exists.
 */
export function traceHeaders(explicit?: string): Readonly<Record<string, string>> {
  const traceparent = explicit ?? currentTraceparent();
  return traceparent === undefined ? {} : { traceparent };
}

/**
 * Emits a Sentry counter metric. Attributes must stay low-cardinality —
 * status, direction, delegate — because each distinct combination becomes its
 * own series.
 */
export function countAgentEvent(name: string, attributes: TelemetryAttributes, value = 1): void {
  Sentry.metrics.count(name, value, { attributes });
}

/**
 * Emits a Sentry distribution metric for values where the spread matters —
 * cost per step, not just how often steps happen. The same low-cardinality
 * attribute rule as `countAgentEvent` applies.
 */
export function distributeAgentEvent(
  name: string,
  value: number,
  unit: string,
  attributes: TelemetryAttributes,
): void {
  Sentry.metrics.distribution(name, value, { unit, attributes });
}

/** Structured logs intentionally contain no prompts, outputs, or exception details. */
export function logAgentEvent(
  event: string,
  attributes: TelemetryAttributes,
  level: "info" | "warn" | "error" = "info",
): void {
  const body = JSON.stringify({ event, ...attributes, traceId: currentTraceId() });
  console[level](body);
}
