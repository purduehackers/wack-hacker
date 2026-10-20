import * as Sentry from "@sentry/node";
import { SentrySpanProcessor } from "@sentry/opentelemetry";
import { defineInstrumentation } from "eve/instrumentation";
import { otelIntegration, type SpanProcessor } from "eve/instrumentation/otel";

const configuredRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1");
const sampleRate =
  Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 1
    ? configuredRate
    : 0.1;
let processor: SentrySpanProcessor | undefined;

// Eve registers the process tracer, propagator and context manager after every
// provider's setup. Construct Sentry's destination only after its client exists.
const destination = {
  onStart: (...args: Parameters<SentrySpanProcessor["onStart"]>) => processor?.onStart(...args),
  onEnd: (...args: Parameters<SentrySpanProcessor["onEnd"]>) => processor?.onEnd(...args),
  async forceFlush() {
    await processor?.forceFlush();
    await Sentry.flush(2_000);
  },
  async shutdown() {
    await processor?.forceFlush();
    await Sentry.close(2_000);
    await processor?.shutdown();
  },
} satisfies SpanProcessor;

export default {
  ...otelIntegration({
    spanProcessors: [destination],
    // Sample this destination by trace ID, preserving a complete trace and
    // leaving Eve's other exporters and propagated trace decisions unchanged.
    exportPolicy: {
      span: ({ traceId }) => ({
        emit: Number.parseInt(traceId.slice(0, 8), 16) / 0x1_0000_0000 < sampleRate,
      }),
    },
  }),
  ...defineInstrumentation({
    setup: ({ agentName }) => {
      process.env["OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT"] ??= "65536";
      const client = Sentry.init({
        skipOpenTelemetrySetup: true,
        dsn: process.env["SENTRY_DSN"],
        enabled: process.env["SENTRY_DSN"] !== undefined,
        environment: process.env["VERCEL_ENV"] ?? process.env["NODE_ENV"] ?? "development",
        release: process.env["SENTRY_RELEASE"],
        serverName: agentName,
        // Same call: this deployment serves one internal guild, and a trace
        // without the requester attached cannot be tied back to the turn someone
        // is asking about.
        sendDefaultPii: true,
        enableLogs: true,
        integrations: [Sentry.consoleLoggingIntegration({ levels: ["info", "warn", "error"] })],
        tracesSampleRate: sampleRate,
      });
      processor = new SentrySpanProcessor(client === undefined ? {} : { client });
    },
  }),
};
