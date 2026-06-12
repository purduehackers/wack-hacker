import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  startActiveSpan,
  span,
  injectMock,
  extractMock,
  contextWithMock,
  deleteSpanMock,
  activeContext,
  ctxState,
} = vi.hoisted(() => {
  // Spy methods are shared across every span the fake tracer creates, so
  // assertions against the singleton `span` cover spans made inside withSpan.
  const spanMethods = {
    end: vi.fn(),
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
  };
  type FakeSpan = typeof spanMethods & {
    spanContext: () => { traceId: string; spanId: string };
  };
  type FakeCtx = { span?: FakeSpan; [key: string]: unknown };
  let spanSeq = 0;
  let traceSeq = 0;
  const makeSpan = (traceId: string): FakeSpan => {
    const spanId = `span-${++spanSeq}`;
    return { ...spanMethods, spanContext: () => ({ traceId, spanId }) };
  };
  const span = makeSpan("trace-singleton");
  const activeContext: FakeCtx = { __active: true };
  const ctxState = { current: activeContext };
  // Mirrors real OTEL semantics: a new span joins the active span's trace, or
  // starts a fresh trace when the active context carries no span.
  const startActiveSpan = vi.fn(
    (_name: string, _opts: unknown, fn: (s: FakeSpan) => unknown): unknown => {
      const parent = ctxState.current.span;
      const newSpan = makeSpan(parent ? parent.spanContext().traceId : `trace-${++traceSeq}`);
      const prev = ctxState.current;
      ctxState.current = { ...ctxState.current, span: newSpan };
      try {
        return fn(newSpan);
      } finally {
        ctxState.current = prev;
      }
    },
  );
  return {
    span,
    activeContext,
    ctxState,
    startActiveSpan,
    injectMock: vi.fn(),
    extractMock: vi.fn(),
    deleteSpanMock: vi.fn((ctx: FakeCtx): FakeCtx => ({ ...ctx, span: undefined })),
    contextWithMock: vi.fn((ctx: FakeCtx, fn: () => unknown): unknown => {
      const prev = ctxState.current;
      ctxState.current = ctx;
      try {
        return fn();
      } finally {
        ctxState.current = prev;
      }
    }),
  };
});

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: vi.fn(() => ({ startActiveSpan })),
    getActiveSpan: vi.fn(() => span),
    deleteSpan: deleteSpanMock,
  },
  context: {
    active: vi.fn(() => ctxState.current),
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
  withDetachedRootSpan,
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

describe("withDetachedRootSpan", () => {
  beforeEach(() => {
    // Serialize whatever span is on the injected context, like the W3C
    // propagator would, so captureTraceparent reflects the active context.
    injectMock.mockImplementation(
      (
        ctx: { span?: { spanContext: () => { traceId: string; spanId: string } } },
        carrier: Record<string, string>,
      ) => {
        const spanContext = ctx.span?.spanContext();
        if (spanContext) {
          carrier.traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-01`;
        }
      },
    );
  });

  it("starts a new root whose traceId differs from the enclosing active span", async () => {
    let outerTraceId: string | undefined;
    let detachedTraceId: string | undefined;
    let nestedTraceId: string | undefined;

    await withSpan("outer", {}, async (outer) => {
      outerTraceId = outer.spanContext().traceId;
      await withDetachedRootSpan("detached", { foo: "bar" }, async (detached) => {
        detachedTraceId = detached.spanContext().traceId;
        // Children opened inside the detached root join its NEW trace, not
        // the enclosing request trace.
        await withSpan("nested", {}, async (nested) => {
          nestedTraceId = nested.spanContext().traceId;
        });
      });
    });

    expect(outerTraceId).toBeDefined();
    expect(detachedTraceId).toBeDefined();
    expect(detachedTraceId).not.toBe(outerTraceId);
    expect(nestedTraceId).toBe(detachedTraceId);
    expect(deleteSpanMock).toHaveBeenCalled();
    expect(startActiveSpan).toHaveBeenCalledWith(
      "detached",
      { attributes: { foo: "bar" } },
      expect.any(Function),
    );
  });

  it("captureTraceparent inside the detached span serializes the new root's context", async () => {
    let outerTraceparent: string | undefined;
    let detachedTraceparent: string | undefined;
    let detachedTraceId: string | undefined;

    await withSpan("outer", {}, async () => {
      outerTraceparent = captureTraceparent();
      await withDetachedRootSpan("detached", {}, async (detached) => {
        detachedTraceId = detached.spanContext().traceId;
        detachedTraceparent = captureTraceparent();
      });
    });

    expect(detachedTraceparent).toBeDefined();
    expect(detachedTraceparent).toContain(detachedTraceId);
    expect(detachedTraceparent).not.toBe(outerTraceparent);
  });
});
