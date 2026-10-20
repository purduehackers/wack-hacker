// Separate process: global OpenTelemetry ownership must match a fresh server.
import { strict as assert } from "node:assert";

import * as Sentry from "@sentry/node";
import { disableInstrumentation } from "eve/instrumentation";
import { z } from "zod";

import contextProvider from "../../../agent/instrumentation/context.ts";
import otelProvider from "../../../agent/instrumentation/otel.ts";
import sentryProvider from "../../../agent/instrumentation/sentry.ts";
import {
  context,
  propagation,
  trace,
} from "../../../node_modules/eve/dist/src/compiled/@opentelemetry/api/index.js";
import {
  finalizeInstrumentationProviders,
  registerInstrumentationProvider,
  seedInstrumentationProviders,
  shutdownInstrumentationProviders,
} from "../../../node_modules/eve/dist/src/instrumentation/providers.js";

const envelopes: string[] = [];
const receiver = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    envelopes.push(await request.text());
    return Response.json({});
  },
});
process.env["SENTRY_DSN"] = `http://test@127.0.0.1:${receiver.port}/1`;
process.env["VERCEL_ENV"] = "production";
process.env["NODE_ENV"] = "production";
delete process.env["EVE_LOCAL_WORKER_APP_ROOT"];

try {
  seedInstrumentationProviders();
  // Keep the production bootstrap ordering; replace only hosted destinations.
  await registerInstrumentationProvider({
    agentName: "wack-test",
    slot: "agent-runs",
    value: disableInstrumentation(),
  });
  for (const [slot, value] of Object.entries({
    context: contextProvider,
    otel: otelProvider,
    sentry: sentryProvider,
  })) {
    await registerInstrumentationProvider({ agentName: "wack-test", slot, value });
  }
  const runtime = finalizeInstrumentationProviders({ serviceName: "wack-test" });
  assert.equal(Sentry.getClient<Sentry.NodeClient>()?.getOptions().skipOpenTelemetrySetup, true);
  const tracer = trace.getTracer("wack.bootstrap-test");
  const root = tracer.startSpan("bootstrap-parent");
  const active = trace.setSpan(context.active(), root);
  let activeTraceId: string | undefined;
  context.with(active, () => {
    activeTraceId = Sentry.getActiveSpan()?.spanContext().traceId;
    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers, {
      set: (carrier, key, value) => {
        carrier[key] = value;
      },
    });
    assert.ok(headers["traceparent"]?.includes(root.spanContext().traceId));
    tracer.startSpan("bootstrap-child").end();
    Sentry.captureException(new Error("bootstrap-error"));
    Sentry.metrics.count("bootstrap.usage", 13);
    Sentry.logger.info("bootstrap-log");
  });
  assert.equal(activeTraceId, root.spanContext().traceId);
  root.end();
  await runtime.forceFlush();
  await Sentry.flush(2_000);
  const body = envelopes.join("\n");
  assert.ok(body.includes("bootstrap-error"), "error export must survive custom OTel setup");
  assert.ok(body.includes("bootstrap.usage"), "usage metrics must survive custom OTel setup");
  assert.ok(body.includes("bootstrap-log"), "logs must survive custom OTel setup");
  const transaction = z.object({
    type: z.literal("transaction"),
    transaction: z.string(),
    spans: z.array(z.object({ description: z.string() })),
  });
  const transactions = body.split("\n").flatMap((line) => {
    try {
      const parsed = transaction.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
  if (process.env["SENTRY_TRACES_SAMPLE_RATE"] === "0") {
    assert.equal(transactions.length, 0);
    // Destination sampling must not disable Eve's tracer.
    assert.notEqual(root.spanContext().traceFlags & 1, 0);
  } else {
    const exported = transactions.find(({ transaction: name }) => name === "bootstrap-parent");
    assert.ok(exported, "the Eve root span must reach Sentry");
    assert.ok(
      exported.spans.some(({ description }) => description === "bootstrap-child"),
      "nested span must reach Sentry",
    );
  }
  process.stdout.write("instrumentation bootstrap passed\n");
} finally {
  await shutdownInstrumentationProviders();
  await receiver.stop(true);
}
