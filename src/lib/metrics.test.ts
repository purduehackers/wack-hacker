import { describe, it, expect, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  metrics: { count: vi.fn(), distribution: vi.fn() },
}));

import * as Sentry from "@sentry/nextjs";

import { countMetric, recordDuration, recordDistribution } from "./metrics";

describe("metrics", () => {
  it("countMetric calls Sentry.metrics.count", () => {
    countMetric("test.event", { key: "value" });
    expect(Sentry.metrics.count).toHaveBeenCalledWith("test.event", 1, {
      attributes: { key: "value" },
    });
  });

  it("countMetric works without attributes", () => {
    countMetric("test.bare");
    expect(Sentry.metrics.count).toHaveBeenCalledWith("test.bare", 1, {
      attributes: undefined,
    });
  });

  it("recordDuration calls Sentry.metrics.distribution with millisecond unit", () => {
    recordDuration("test.duration", 123, { op: "run" });
    expect(Sentry.metrics.distribution).toHaveBeenCalledWith("test.duration", 123, {
      unit: "millisecond",
      attributes: { op: "run" },
    });
  });

  it("recordDistribution calls Sentry.metrics.distribution without unit", () => {
    recordDistribution("test.dist", 42, { domain: "ai" });
    expect(Sentry.metrics.distribution).toHaveBeenCalledWith("test.dist", 42, {
      attributes: { domain: "ai" },
    });
  });
});
