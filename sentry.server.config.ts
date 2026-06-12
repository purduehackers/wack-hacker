import * as Sentry from "@sentry/nextjs";
import { waitUntil } from "@vercel/functions";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://23174d7cbef96f2fd9276db93bd566cf@o4510744753405952.ingest.us.sentry.io/4511219848904704",

  tracesSampler: ({ name, parentSampled }) => {
    if (process.env.NODE_ENV === "development") return 1.0;
    // Propagated traces follow the parent's decision so a distributed trace
    // (gateway → queue → workflow → agent) is never partially sampled.
    if (typeof parentSampled === "boolean") return parentSampled;
    // The keepalive cron pings this route every 9 minutes (~160 no-value
    // invocations/day); real event traces root at gateway.relay instead.
    if (name.includes("/api/discord/gateway")) return 0.01;
    // Cron executions root at the HTTP request span (`cron.execute` is its
    // child and inherits via parentSampled), so the route is what must be
    // fully sampled — ~25 low-volume invocations/day.
    if (name.includes("/api/crons/")) return 1.0;
    const fullySampledRoots = [
      "gateway.relay",
      "discord.event",
      "chat.",
      "workflow",
      "scheduled_task.fire",
      "cron.execute",
    ];
    if (fullySampledRoots.some((root) => name.startsWith(root))) return 1.0;
    return 0.1;
  },

  sendDefaultPii: true,
  includeLocalVariables: true,
  enableLogs: true,

  integrations: [
    // `force: true` because the `ai` package is bundled by Next, so the
    // integration's CJS require-hook never observes it and would otherwise
    // skip registering its ai.* → gen_ai.* span processors.
    Sentry.vercelAIIntegration({ force: true, recordInputs: true, recordOutputs: true }),
    // evlog wide events are JSON lines on stdout; this turns them into
    // Sentry Logs (requires enableLogs), joined to traces by the trace.id
    // that createWideLogger injects.
    Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
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
