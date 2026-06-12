import { describe, expect, it, vi } from "vitest";

const { baseEmit, baseError, traceId } = vi.hoisted(() => ({
  baseEmit: vi.fn((overrides: Record<string, unknown>) => ({ emitted: overrides })),
  baseError: vi.fn(),
  traceId: { current: undefined as string | undefined },
}));

vi.mock("evlog", () => ({
  createLogger: vi.fn((context: Record<string, unknown>) => ({
    set: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: baseError,
    emit: baseEmit,
    getContext: () => context,
  })),
}));

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getActiveSpan: () =>
      traceId.current ? { spanContext: () => ({ traceId: traceId.current }) } : undefined,
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";

import { createWideLogger } from "./wide";

describe("createWideLogger", () => {
  it("injects the current OTEL trace id on emit when available", () => {
    traceId.current = "abc123";
    baseEmit.mockClear();
    const logger = createWideLogger({ op: "test.op" });
    logger.emit({ outcome: "ok" });
    expect(baseEmit).toHaveBeenCalledWith({ trace: { id: "abc123" }, outcome: "ok" });
  });

  it("omits trace id when no active span exists", () => {
    traceId.current = undefined;
    baseEmit.mockClear();
    const logger = createWideLogger({ op: "test.op" });
    logger.emit({ outcome: "ok" });
    expect(baseEmit).toHaveBeenCalledWith({ outcome: "ok" });
  });

  it("defaults overrides to an empty object when caller omits them", () => {
    traceId.current = undefined;
    baseEmit.mockClear();
    const logger = createWideLogger({ op: "test.op" });
    logger.emit();
    expect(baseEmit).toHaveBeenCalledWith({});
  });

  it("forwards .error() to Sentry.captureException exactly once and delegates to evlog", () => {
    baseError.mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    const logger = createWideLogger({ op: "test.op" });
    const boom = new Error("bang");
    logger.error(boom, { step: "publish" });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom);
    expect(baseError).toHaveBeenCalledTimes(1);
    expect(baseError).toHaveBeenCalledWith(boom, { step: "publish" });
  });

  it("forwards string errors to Sentry.captureException as well", () => {
    baseError.mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    const logger = createWideLogger({ op: "test.op" });
    logger.error("publish failed");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith("publish failed");
    expect(baseError).toHaveBeenCalledWith("publish failed", undefined);
  });

  it("does not capture to Sentry on emit", () => {
    traceId.current = "abc123";
    baseEmit.mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    const logger = createWideLogger({ op: "test.op" });
    logger.emit({ outcome: "error" });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
