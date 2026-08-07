import { describe, expect, test } from "bun:test";

import { healthReportSchema, readyHealthReportSchema } from "./bot-health.ts";

const valid = { ready: true, websocketPingMs: 42, uptimeSeconds: 60 };

describe("bot health contract", () => {
  test("accepts both ready and not-ready reports and ignores additive fields", () => {
    expect(healthReportSchema.parse({ ...valid, diagnostic: "ignored" })).toEqual(valid);
    expect(healthReportSchema.safeParse({ ...valid, ready: false }).success).toBeTrue();
  });

  test("requires ready for supervisor and release probes", () => {
    expect(readyHealthReportSchema.safeParse(valid).success).toBeTrue();
    expect(readyHealthReportSchema.safeParse({ ...valid, ready: false }).success).toBeFalse();
  });

  test.each([
    ["ping below the sentinel", { ...valid, websocketPingMs: -2 }],
    ["fractional ping", { ...valid, websocketPingMs: 1.5 }],
    ["nonfinite ping", { ...valid, websocketPingMs: Number.NaN }],
    ["negative uptime", { ...valid, uptimeSeconds: -1 }],
    ["fractional uptime", { ...valid, uptimeSeconds: 1.5 }],
    ["unsafe uptime", { ...valid, uptimeSeconds: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s", (_label, candidate) => {
    expect(healthReportSchema.safeParse(candidate).success).toBeFalse();
  });
});
