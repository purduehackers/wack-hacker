import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ messageId: "qmsg-1" }),
  handleCallback: vi.fn(),
}));

vi.mock("@vercel/queue", () => ({
  QueueClient: class MockQueueClient {
    send = hoisted.send;
    handleCallback = hoisted.handleCallback;
  },
}));

const { scheduleTask } = await import("./schedule");

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.send.mockResolvedValue({ messageId: "qmsg-1" });
});

describe("scheduleTask", () => {
  it("sends envelope to the tasks topic", async () => {
    const id = await scheduleTask(
      "send-message",
      { channelId: "ch-1", content: "hi" },
      { delaySeconds: 60 },
    );

    expect(id).toBe("qmsg-1");
    expect(hoisted.send).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        task: "send-message",
        payload: { channelId: "ch-1", content: "hi" },
      }),
      { delaySeconds: 60 },
    );
  });

  it("defaults delaySeconds to 0", async () => {
    await scheduleTask("send-message", {});
    expect(hoisted.send).toHaveBeenCalledWith("tasks", expect.any(Object), { delaySeconds: 0 });
  });

  it("includes recurring config with repetitionCount 0", async () => {
    await scheduleTask("send-message", {}, { recurring: { delaySeconds: 300, maxRepetitions: 5 } });

    expect(hoisted.send).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        recurring: { delaySeconds: 300, maxRepetitions: 5, repetitionCount: 0 },
      }),
      expect.any(Object),
    );
  });

  it("returns null when send returns no messageId", async () => {
    hoisted.send.mockResolvedValueOnce({ messageId: null });
    const id = await scheduleTask("send-message", {});
    expect(id).toBeNull();
  });
});
