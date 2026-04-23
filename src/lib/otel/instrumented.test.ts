import { describe, expect, it, vi } from "vitest";

import * as wideLogger from "../logging/wide.ts";
import { runInstrumented } from "./instrumented.ts";

describe("runInstrumented", () => {
  it("returns the function's result", async () => {
    const result = await runInstrumented({ op: "test.ok" }, async () => 42);
    expect(result).toBe(42);
  });

  it("emits a terminal ok event with duration_ms on success", async () => {
    const emit = vi.fn();
    const mockLogger = {
      emit,
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never;
    vi.spyOn(wideLogger, "createWideLogger").mockReturnValueOnce(mockLogger);

    await runInstrumented({ op: "test.ok" }, async () => "done");

    expect(emit).toHaveBeenCalledOnce();
    const payload = emit.mock.calls[0][0];
    expect(payload.outcome).toBe("ok");
    expect(typeof payload.duration_ms).toBe("number");
    expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("emits a terminal error event with class/message and rethrows", async () => {
    const emit = vi.fn();
    const error = vi.fn();
    const mockLogger = {
      emit,
      error,
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as never;
    vi.spyOn(wideLogger, "createWideLogger").mockReturnValueOnce(mockLogger);

    const boom = new Error("bang");
    boom.name = "BoomError";
    await expect(
      runInstrumented({ op: "test.err" }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(error).toHaveBeenCalledWith(boom);
    const payload = emit.mock.calls[0][0];
    expect(payload.outcome).toBe("error");
    expect(payload.error_class).toBe("BoomError");
    expect(payload.error_message).toBe("bang");
    expect(typeof payload.duration_ms).toBe("number");
  });

  it("scopes logger with the provided context", async () => {
    const spy = vi.spyOn(wideLogger, "createWideLogger");

    await runInstrumented(
      { op: "test.ctx", loggerContext: { chat: { id: "c-1" }, user: { id: "u-1" } } },
      async () => {},
    );

    expect(spy).toHaveBeenCalledWith({
      op: "test.ctx",
      chat: { id: "c-1" },
      user: { id: "u-1" },
    });
  });

  it("passes traceparent through to withSpanFromParent when provided", async () => {
    // Runs without error even when the traceparent doesn't correspond to a real
    // parent — withSpanFromParent falls back to a root span in that case.
    const emit = vi.fn();
    vi.spyOn(wideLogger, "createWideLogger").mockReturnValueOnce({
      emit,
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never);

    const result = await runInstrumented(
      { op: "test.tp", traceparent: "00-11111111111111111111111111111111-2222222222222222-01" },
      async () => "out",
    );

    expect(result).toBe("out");
    expect(emit).toHaveBeenCalledOnce();
  });
});
