import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";

/** Keep the existing Sentry initialization; Eve owns its OTel pipeline. */
export default defineInstrumentation({
  setup: ({ agentName }) => {
    process.env["OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT"] ??= "65536";
    const sampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1");
    Sentry.init({
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
      tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
    });
  },
});
