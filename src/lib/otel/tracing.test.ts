import { describe, expect, it, vi } from "vitest";

const { startActiveSpan, span } = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
  };
  return {
    span,
    startActiveSpan: vi.fn((_name: string, _opts: unknown, fn: (s: typeof span) => unknown) =>
      fn(span),
    ),
  };
});

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: vi.fn(() => ({ startActiveSpan })),
    getActiveSpan: vi.fn(() => span),
  },
}));

import { setActiveSpanAttributes, withSpan } from "./tracing";

describe("withSpan", () => {
  it("runs fn inside a span and ends it on success", async () => {
    const result = await withSpan("test.span", { foo: "bar" }, async () => "ok");
    expect(result).toBe("ok");
    expect(startActiveSpan).toHaveBeenCalledWith(
      "test.span",
      { attributes: { foo: "bar" } },
      expect.any(Function),
    );
    expect(span.end).toHaveBeenCalled();
  });

  it("records exceptions, sets error status, rethrows, and still ends", async () => {
    const err = new Error("boom");
    await expect(withSpan("failing.span", {}, async () => Promise.reject(err))).rejects.toBe(err);
    expect(span.recordException).toHaveBeenCalledWith(err);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: "boom" });
    expect(span.end).toHaveBeenCalled();
  });

  it("stringifies non-Error throws for the status message", async () => {
    await expect(
      withSpan("throw-string", {}, async () => {
        throw "nope";
      }),
    ).rejects.toBe("nope");
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: "nope" });
  });
});

describe("setActiveSpanAttributes", () => {
  it("forwards attributes to the active span", () => {
    setActiveSpanAttributes({ foo: "bar" });
    expect(span.setAttributes).toHaveBeenCalledWith({ foo: "bar" });
  });
});
