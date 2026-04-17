import * as Sentry from "@sentry/nextjs";
import { waitUntil } from "@vercel/functions";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://23174d7cbef96f2fd9276db93bd566cf@o4510744753405952.ingest.us.sentry.io/4511219848904704",

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  sendDefaultPii: true,
  includeLocalVariables: true,
  enableLogs: true,

  integrations: [
    Sentry.vercelAIIntegration({ recordInputs: true, recordOutputs: true }),
    Sentry.anrIntegration({ captureStackTrace: true, anrThreshold: 5000 }),
  ],
});

// Sentry v10's `vercelWaitUntil` is a no-op in Node runtime (see
// @sentry/core/utils/vercelWaitUntil.js: `if (typeof EdgeRuntime !== 'string') return;`),
// so the SDK's per-request metric flush never runs on Fluid Compute and buffered
// trace_metric envelopes are lost when the function is suspended. Bridge the gap by
// scheduling a real `@vercel/functions` waitUntil on every metric capture; outside a
// request context waitUntil is a safe no-op.
Sentry.getClient()?.on("afterCaptureMetric", () => {
  waitUntil(Sentry.flush(2000).catch(() => false));
});
