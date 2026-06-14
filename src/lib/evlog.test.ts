import { beforeEach, describe, expect, it, vi } from "vitest";

const { sentryLogger, captured } = vi.hoisted(() => ({
  sentryLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captured: {
    drain: undefined as undefined | ((ctx: { event: Record<string, unknown> }) => void),
  },
}));

vi.mock("@sentry/nextjs", () => ({ logger: sentryLogger }));
// Capture the drain the module wires into createInstrumentation so we can drive
// it directly — this tests the real wiring, not just an exported helper.
vi.mock("evlog/next/instrumentation", () => ({
  createInstrumentation: (opts: { drain?: (ctx: { event: Record<string, unknown> }) => void }) => {
    captured.drain = opts.drain;
    return { register: () => {}, onRequestError: () => {} };
  },
}));

await import("./evlog.ts");
const drain = captured.drain!;

function emit(event: Record<string, unknown>): void {
  drain({ event });
}

describe("evlog → Sentry logs drain", () => {
  beforeEach(() => {
    for (const fn of Object.values(sentryLogger)) fn.mockClear();
  });

  it("routes each evlog level to the matching Sentry logger method", () => {
    emit({ level: "info", op: "gateway.relay", outcome: "ok" });
    emit({ level: "warn", op: "x" });
    emit({ level: "error", op: "y" });
    emit({ level: "debug", op: "z" });
    expect(sentryLogger.info).toHaveBeenCalledTimes(1);
    expect(sentryLogger.warn).toHaveBeenCalledTimes(1);
    expect(sentryLogger.error).toHaveBeenCalledTimes(1);
    expect(sentryLogger.debug).toHaveBeenCalledTimes(1);
  });

  it("falls back to info for an unrecognized level", () => {
    emit({ level: "fatal", op: "x" });
    expect(sentryLogger.info).toHaveBeenCalledTimes(1);
  });

  it("builds the log body from op + outcome", () => {
    emit({ level: "info", op: "ai.turn", outcome: "ok" });
    expect(sentryLogger.info).toHaveBeenCalledWith("ai.turn ok", expect.any(Object));
  });

  it("prefers an explicit message, then op, then tag, else 'event'", () => {
    emit({ level: "info", message: "hello", op: "ai.turn" });
    expect(sentryLogger.info).toHaveBeenLastCalledWith("hello", expect.any(Object));
    emit({ level: "info", tag: "gateway" });
    expect(sentryLogger.info).toHaveBeenLastCalledWith("gateway", expect.any(Object));
    emit({ level: "info" });
    expect(sentryLogger.info).toHaveBeenLastCalledWith("event", expect.any(Object));
  });

  it("forwards primitive fields as attributes and drops envelope fields", () => {
    emit({
      level: "info",
      op: "ai.turn",
      outcome: "ok",
      timestamp: "2026-06-13T00:00:00.000Z",
      service: "wack-hacker",
      environment: "production",
      version: "abc",
      commitHash: "deadbeef",
      region: "iad1",
      tokens: 1234,
      cached: true,
      message: "not-an-attribute",
    });
    const attrs = sentryLogger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(attrs).toMatchObject({ op: "ai.turn", outcome: "ok", tokens: 1234, cached: true });
    for (const dropped of [
      "timestamp",
      "level",
      "service",
      "environment",
      "version",
      "commitHash",
      "region",
      "message",
    ]) {
      expect(attrs).not.toHaveProperty(dropped);
    }
  });

  it("serializes nested objects/arrays and skips null/undefined", () => {
    emit({
      level: "error",
      op: "ai.subagent",
      subagent: { domain: "linear", model: "gpt" },
      domains: ["linear", "notion"],
      missing: null,
      absent: undefined,
    });
    const attrs = sentryLogger.error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(attrs.subagent).toBe(JSON.stringify({ domain: "linear", model: "gpt" }));
    expect(attrs.domains).toBe(JSON.stringify(["linear", "notion"]));
    expect(attrs).not.toHaveProperty("missing");
    expect(attrs).not.toHaveProperty("absent");
  });

  it("drops un-serializable (cyclic) values without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => emit({ level: "info", op: "x", cyclic })).not.toThrow();
    const attrs = sentryLogger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(attrs).not.toHaveProperty("cyclic");
  });
});
