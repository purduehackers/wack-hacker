/** Low-cardinality Sentry telemetry and W3C propagation for the Eve process. */

import * as Sentry from "@sentry/node";

export type TelemetryAttribute = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryAttribute>>;

export function turnTokenKey(sessionId: string, turnId: string): string {
  return `agent:turn-tokens:${sessionId}:${turnId}`;
}

export function currentTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  return span === undefined ? undefined : Sentry.spanToJSON(span).trace_id;
}

export function currentTraceparent(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (span === undefined) return undefined;
  const spanContext = span.spanContext();
  if (/^0{32}$/u.test(spanContext.traceId) || /^0{16}$/u.test(spanContext.spanId)) return undefined;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

export function traceHeaders(explicit?: string): Readonly<Record<string, string>> {
  const traceparent = explicit ?? currentTraceparent();
  return traceparent === undefined ? {} : { traceparent };
}

export function countAgentEvent(name: string, attributes: TelemetryAttributes, value = 1): void {
  Sentry.metrics.count(name, value, { attributes });
}

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
