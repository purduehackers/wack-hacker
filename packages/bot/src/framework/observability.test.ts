import { describe, expect, test } from "bun:test";

import { recordOperationMetrics, wideEventLine } from "./observability.ts";

describe("bot telemetry accounting", () => {
  test("wide-event attributes cannot overwrite canonical accounting fields", () => {
    const event: Record<string, unknown> = JSON.parse(
      wideEventLine(
        {
          op: "agent.render.apply",
          status: "error",
          errorTag: "Transient",
          attributes: { op: "spoofed", status: "ok", traceId: "spoofed" },
        },
        "trace-1",
      ),
    );

    expect(event).toMatchObject({
      event: "operation.completed",
      op: "agent.render.apply",
      status: "error",
      errorTag: "Transient",
      traceId: "trace-1",
    });
  });

  test("counts every outcome and records latency without high-cardinality attributes", () => {
    const calls: unknown[][] = [];
    const metrics = {
      count: (...args: unknown[]) => calls.push(["count", ...args]),
      distribution: (...args: unknown[]) => calls.push(["distribution", ...args]),
    };

    recordOperationMetrics(
      {
        op: "agent.render.apply",
        status: "ok",
        durationMs: 42,
        attributes: { dispatchId: "high-cardinality-id" },
      },
      metrics,
    );

    expect(calls).toEqual([
      ["count", "bot.operation", 1, { attributes: { op: "agent.render.apply", status: "ok" } }],
      [
        "distribution",
        "bot.operation.duration",
        42,
        {
          unit: "millisecond",
          attributes: { op: "agent.render.apply", status: "ok" },
        },
      ],
    ]);
  });
});
