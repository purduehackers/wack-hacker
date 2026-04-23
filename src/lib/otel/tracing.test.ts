import { beforeEach, describe, expect, it, vi } from "vitest";

const { startActiveSpan, span, injectMock, extractMock, contextWithMock, activeContext } =
  vi.hoisted(() => {
    const span = {
      end: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    };
    const activeContext = { __active: true };
    return {
      span,
      activeContext,
      startActiveSpan: vi.fn((_name: string, _opts: unknown, fn: (s: typeof span) => unknown) =>
        fn(span),
      ),
      injectMock: vi.fn(),
      extractMock: vi.fn(),
      contextWithMock: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
    };
  });

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: vi.fn(() => ({ startActiveSpan })),
    getActiveSpan: vi.fn(() => span),
  },
  context: {
    active: vi.fn(() => activeContext),
    with: contextWithMock,
  },
  propagation: {
    inject: injectMock,
    extract: extractMock,
  },
}));

import {
  captureTraceparent,
  setActiveSpanAttributes,
  withSpan,
  withSpanFromParent,
} from "./tracing";

beforeEach(() => {
  injectMock.mockReset();
  extractMock.mockReset();
  contextWithMock.mockClear();
  startActiveSpan.mockClear();
});

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

describe("captureTraceparent", () => {
  it("returns the traceparent injected by the propagator", () => {
    injectMock.mockImplementation((_ctx: unknown, carrier: Record<string, string>) => {
      carrier.traceparent = "00-aaaa-bbbb-01";
    });
    expect(captureTraceparent()).toBe("00-aaaa-bbbb-01");
    // Injector is called against the active context with a carrier object.
    expect(injectMock).toHaveBeenCalledTimes(1);
    expect(injectMock.mock.calls[0][0]).toBe(activeContext);
  });

  it("returns undefined when the propagator injects nothing", () => {
    injectMock.mockImplementation(() => {});
    expect(captureTraceparent()).toBeUndefined();
  });
});

describe("withSpanFromParent", () => {
  it("falls through to withSpan when no traceparent is provided", async () => {
    const result = await withSpanFromParent(undefined, "no-parent", { foo: 1 }, async () => "ok");
    expect(result).toBe("ok");
    expect(extractMock).not.toHaveBeenCalled();
    expect(contextWithMock).not.toHaveBeenCalled();
    expect(startActiveSpan).toHaveBeenCalledWith(
      "no-parent",
      { attributes: { foo: 1 } },
      expect.any(Function),
    );
  });

  it("extracts the parent context and runs withSpan inside it", async () => {
    const extractedCtx = { __extracted: true };
    extractMock.mockReturnValue(extractedCtx);
    const result = await withSpanFromParent(
      "00-trace-span-01",
      "with-parent",
      { bar: 2 },
      async () => "done",
    );
    expect(result).toBe("done");
    expect(extractMock).toHaveBeenCalledWith(activeContext, { traceparent: "00-trace-span-01" });
    expect(contextWithMock).toHaveBeenCalledWith(extractedCtx, expect.any(Function));
    expect(startActiveSpan).toHaveBeenCalledWith(
      "with-parent",
      { attributes: { bar: 2 } },
      expect.any(Function),
    );
  });
});
