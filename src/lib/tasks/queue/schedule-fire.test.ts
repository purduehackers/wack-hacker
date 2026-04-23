import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
}));

vi.mock("./client.ts", () => ({
  send: hoisted.send,
}));

const { sendScheduledFire } = await import("./schedule-fire.ts");
const { SCHEDULED_TASK_FIRE_TASK, TASK_TOPIC } = await import("./constants.ts");

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.send.mockResolvedValue({ messageId: "msg-123" });
});

describe("sendScheduledFire", () => {
  it("enqueues the task with capped delay and idempotency key", async () => {
    const target = new Date("2026-06-01T12:00:00.000Z");
    const { messageId } = await sendScheduledFire("task-7", target, 3_600);

    expect(messageId).toBe("msg-123");
    expect(hoisted.send).toHaveBeenCalledTimes(1);
    const [topic, envelope, options] = hoisted.send.mock.calls[0];
    expect(topic).toBe(TASK_TOPIC);
    expect(envelope).toEqual({
      task: SCHEDULED_TASK_FIRE_TASK,
      payload: { taskId: "task-7", targetIso: "2026-06-01T12:00:00.000Z" },
    });
    expect(options).toEqual({
      delaySeconds: 3_600,
      retentionSeconds: 604_800,
      idempotencyKey: "task-7:2026-06-01T12:00:00.000Z",
    });
  });

  it("clamps horizons past 6 days to the 6-day checkpoint", async () => {
    const target = new Date("2026-07-15T00:00:00.000Z");
    await sendScheduledFire("task-8", target, 30 * 86_400);

    const [, , options] = hoisted.send.mock.calls[0];
    expect(options.delaySeconds).toBe(518_400);
  });

  it("clamps negative delays to zero", async () => {
    const target = new Date("2026-04-01T00:00:00.000Z");
    await sendScheduledFire("task-9", target, -120);

    const [, , options] = hoisted.send.mock.calls[0];
    expect(options.delaySeconds).toBe(0);
  });

  it("floors fractional seconds", async () => {
    const target = new Date("2026-04-30T12:00:00.000Z");
    await sendScheduledFire("task-10", target, 59.9);

    const [, , options] = hoisted.send.mock.calls[0];
    expect(options.delaySeconds).toBe(59);
  });
});
