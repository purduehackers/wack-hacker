import type { DrainContext, WideEvent } from "evlog";

import * as Sentry from "@sentry/nextjs";
import { createInstrumentation } from "evlog/next/instrumentation";

// evlog only ever emits these four levels; each maps 1:1 to a Sentry
// structured-log method (Sentry also has trace/fatal, which evlog never uses).
const LOG_METHOD = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
} as const;

// Envelope fields evlog stamps on every event. Sentry records the equivalents
// at the SDK level (release, environment, server) and `level`/`timestamp` are
// first-class on a log, so re-sending them as attributes would be redundant.
// `message` is lifted out into the log body instead of an attribute.
const ENVELOPE_FIELDS = new Set([
  "timestamp",
  "level",
  "service",
  "environment",
  "version",
  "commitHash",
  "region",
  "message",
]);

/**
 * Forward one evlog wide event to Sentry structured logs (Explore → Logs).
 *
 * This is the logs pipeline: a single drain on the global evlog logger, so
 * every wide event — `createWideLogger().emit()`, the request logger, and the
 * global `log.*` tagged logs in production — lands in Sentry as a structured
 * log with its fields preserved as queryable attributes. It runs synchronously
 * inside evlog's emit, so the active OTEL span is still current and Sentry
 * joins the log to its trace automatically (`createWideLogger` also stamps an
 * explicit `trace.id`). evlog has already redacted PII before the drain fires.
 *
 * Forwarding the structured event directly is why this replaces
 * `consoleLoggingIntegration`: that integration would only see the JSON string
 * evlog prints to stdout and capture it as opaque text, losing the per-field
 * attributes. stdout is left untouched so Vercel's own log capture still works.
 */
function drainToSentry({ event }: DrainContext): void {
  const level = LOG_METHOD[event.level] ?? "info";
  Sentry.logger[level](logMessage(event), toLogAttributes(event));
}

/** Human-readable log body: an explicit message, else `op`/`tag` + outcome. */
function logMessage(event: WideEvent): string {
  if (typeof event.message === "string") return event.message;
  const label =
    typeof event.op === "string" ? event.op : typeof event.tag === "string" ? event.tag : undefined;
  if (!label) return "event";
  return typeof event.outcome === "string" ? `${label} ${event.outcome}` : label;
}

function toLogAttributes(event: WideEvent): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event)) {
    if (ENVELOPE_FIELDS.has(key) || value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attrs[key] = value;
    } else {
      // Sentry log attributes are flat primitives; nested objects (`event`,
      // `error`, `subagent`, …) and arrays are JSON-serialized so their detail
      // survives. Un-serializable values (cycles) are dropped, not fatal.
      try {
        attrs[key] = JSON.stringify(value);
      } catch {
        // Skip this attribute rather than lose the whole log line.
      }
    }
  }
  return attrs;
}

export const { register, onRequestError } = createInstrumentation({
  service: "wack-hacker",
  drain: drainToSentry,
});
