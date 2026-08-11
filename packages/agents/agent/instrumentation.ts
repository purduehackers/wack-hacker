import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";

export default defineInstrumentation({
  // Prompts and completions are attached to spans, which is what Sentry's AI
  // conversation view reconstructs a turn from — without them it has spans and
  // timings but nothing to show. This is an internal Discord assistant for one
  // guild, and the alternative was being unable to see why a turn was slow.
  recordInputs: true,
  recordOutputs: true,
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
