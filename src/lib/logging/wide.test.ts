import { describe, expect, it, vi } from "vitest";

const { baseEmit, traceId } = vi.hoisted(() => ({
  baseEmit: vi.fn((overrides: Record<string, unknown>) => ({ emitted: overrides })),
  traceId: { current: undefined as string | undefined },
}));

vi.mock("evlog", () => ({
  createLogger: vi.fn((context: Record<string, unknown>) => ({
    set: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
});
