import * as Sentry from "@sentry/bun";

const sampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1");

Sentry.init({
  dsn: process.env["SENTRY_DSN"],
  enabled: process.env["SENTRY_DSN"] !== undefined,
  environment: process.env["VERCEL_ENV"] ?? process.env["NODE_ENV"] ?? "development",
  release: process.env["SENTRY_RELEASE"],
  sendDefaultPii: false,
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["info", "warn", "error"] })],
  tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
});
