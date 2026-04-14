import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMock, handleCallbackMock, constructorSpy } = vi.hoisted(() => {
  const sendMock = vi.fn().mockResolvedValue({ messageId: "qmsg-1" });
  const handleCallbackMock = vi.fn().mockReturnValue(() => new Response());
  const constructorSpy = vi.fn();
  return { sendMock, handleCallbackMock, constructorSpy };
});

vi.mock("@vercel/queue", () => {
  class QueueClient {
    send = sendMock;
    handleCallback = handleCallbackMock;
    constructor(options: unknown) {
      constructorSpy(options);
    }
  }
  return { QueueClient };
});

const { send, handleCallback } = await import("./client.ts");

beforeEach(() => {
  sendMock.mockClear();
  handleCallbackMock.mockClear();
});

describe("queue", () => {
  it("constructs QueueClient with region iad1", () => {
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledWith({ region: "iad1" });
  });

  it("send forwards arguments to the underlying client", async () => {
    const result = await send("tasks", { foo: "bar" }, { delaySeconds: 30 });

    expect(sendMock).toHaveBeenCalledWith("tasks", { foo: "bar" }, { delaySeconds: 30 });
    expect(result).toEqual({ messageId: "qmsg-1" });
  });

  it("send works without options", async () => {
    await send("tasks", { foo: "bar" });
    expect(sendMock).toHaveBeenCalledWith("tasks", { foo: "bar" }, undefined);
  });

  it("handleCallback forwards handler and options to the underlying client", () => {
    const handler = vi.fn();
    const options = { visibilityTimeoutSeconds: 120 };

    handleCallback(handler, options);

    expect(handleCallbackMock).toHaveBeenCalledWith(handler, options);
  });
});
