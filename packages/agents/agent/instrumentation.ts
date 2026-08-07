import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";

export default defineInstrumentation({
  recordInputs: false,
  recordOutputs: false,
  // Eve extracts W3C traceparent from authored-channel request headers and
  // parents its channel/Workflow spans beneath the bot span.
  traceChannelRequests: true,
  setup: ({ agentName }) => {
    process.env["OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT"] ??= "65536";
    const sampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1");
    Sentry.init({
      dsn: process.env["SENTRY_DSN"],
      enabled: process.env["SENTRY_DSN"] !== undefined,
      environment: process.env["VERCEL_ENV"] ?? process.env["NODE_ENV"] ?? "development",
      release: process.env["SENTRY_RELEASE"],
      serverName: agentName,
      sendDefaultPii: false,
      enableLogs: true,
      integrations: [Sentry.consoleLoggingIntegration({ levels: ["info", "warn", "error"] })],
      tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
    });
  },
});
