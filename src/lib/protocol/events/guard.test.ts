import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/metrics", () => ({
  countMetric: vi.fn(),
}));
vi.mock("evlog", () => ({
  log: { error: vi.fn() },
}));

import { log } from "evlog";

import { countMetric } from "@/lib/metrics";

import { guardEvent } from "./guard.ts";

describe("guardEvent", () => {
  it("runs the handler body", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await guardEvent("messageCreate", run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("swallows a throwing handler, recording a metric and log instead of rejecting", async () => {
    await expect(
      guardEvent("messageReactionAdd", async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();

    expect(countMetric).toHaveBeenCalledWith("gateway.handler_error", {
      event: "messageReactionAdd",
    });
    expect(log.error).toHaveBeenCalledWith("gateway", expect.stringContaining("boom"));
  });
});
