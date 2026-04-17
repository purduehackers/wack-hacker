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
// scheduling a real `@vercel/functions` waitUntil on each metric capture; outside a
// request context waitUntil is a safe no-op.
//
// `afterCaptureMetric` fires for every metric (ai.turn.*, event.*, etc.), so
// naively flushing per-capture spawns many concurrent flushes and inflates
// invocation tail time. Hold a gate for the full duration of the flush (not just
// until it starts) so captures arriving while a flush is in flight don't schedule
// another concurrent `waitUntil`. Those late captures flip `flushPending`, and
// the loop runs one more flush per pending cycle before releasing the gate.
let flushInFlight = false;
let flushPending = false;

async function runCoalescedFlush(): Promise<void> {
  flushInFlight = true;
  try {
    // Yield once so metrics captured synchronously in the same tick land in the
    // buffer before the first envelope is cut, collapsing a burst into one round trip.
    await Promise.resolve();
    do {
      flushPending = false;
      await Sentry.flush(2000).catch(() => false);
    } while (flushPending);
  } finally {
    flushInFlight = false;
  }
}

Sentry.getClient()?.on("afterCaptureMetric", () => {
  if (flushInFlight) {
    flushPending = true;
    return;
  }
  waitUntil(runCoalescedFlush());
});
