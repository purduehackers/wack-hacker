import { describe, expect, it, vi } from "vitest";

const { errorSpy, emitSpy } = vi.hoisted(() => ({ errorSpy: vi.fn(), emitSpy: vi.fn() }));

vi.mock("@/lib/metrics", () => ({
  countMetric: vi.fn(),
}));
vi.mock("@/lib/logging/wide", () => ({
  createWideLogger: vi.fn(() => ({
    error: errorSpy,
    emit: emitSpy,
    set: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { countMetric } from "@/lib/metrics";

import { guardEvent } from "./guard.ts";

describe("guardEvent", () => {
  it("runs the handler body", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await guardEvent("messageCreate", run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("swallows a throwing handler, counting a metric and capturing the error instead of rejecting", async () => {
    const boom = new Error("boom");
    await expect(
      guardEvent("messageReactionAdd", async () => {
        throw boom;
      }),
    ).resolves.toBeUndefined();

    expect(countMetric).toHaveBeenCalledWith("gateway.handler_error", {
      event: "messageReactionAdd",
    });
    // The error becomes a Sentry issue (createWideLogger().error → captureException)
    // plus a structured wide event, not just a bare log.
    expect(errorSpy).toHaveBeenCalledWith(boom);
    expect(emitSpy).toHaveBeenCalledWith({ outcome: "error" });
  });
});
