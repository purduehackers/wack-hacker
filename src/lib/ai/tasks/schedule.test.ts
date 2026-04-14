import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/queue", () => ({
  send: vi.fn().mockResolvedValue({ messageId: "qmsg-1" }),
}));

const { send } = await import("@vercel/queue");
const { scheduleTask } = await import("./schedule");

const mockedSend = vi.mocked(send);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ messageId: "qmsg-1" });
});

describe("scheduleTask", () => {
  it("sends envelope to the tasks topic", async () => {
    const id = await scheduleTask(
      "send-message",
      { channelId: "ch-1", content: "hi" },
      { delaySeconds: 60 },
    );

    expect(id).toBe("qmsg-1");
    expect(mockedSend).toHaveBeenCalledWith(
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
    expect(mockedSend).toHaveBeenCalledWith("tasks", expect.any(Object), { delaySeconds: 0 });
  });

  it("includes recurring config with repetitionCount 0", async () => {
    await scheduleTask("send-message", {}, { recurring: { delaySeconds: 300, maxRepetitions: 5 } });

    expect(mockedSend).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        recurring: { delaySeconds: 300, maxRepetitions: 5, repetitionCount: 0 },
      }),
      expect.any(Object),
    );
  });

  it("returns null when send returns no messageId", async () => {
    mockedSend.mockResolvedValueOnce({ messageId: null });
    const id = await scheduleTask("send-message", {});
    expect(id).toBeNull();
  });
});
