import { DuplicateMessageError } from "@vercel/queue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduledTaskRow } from "@/lib/tasks/types";

import { ScheduledTaskStatus, ScheduleType } from "@/lib/tasks/enums";
import { asAPI, createMockAPI } from "@/lib/test/fixtures";

const hoisted = vi.hoisted(() => ({
  listOverdueActiveTasks: vi.fn<(cutoffIso: string) => Promise<ScheduledTaskRow[]>>(),
  sendScheduledFire: vi
    .fn()
    .mockResolvedValue({ messageId: "msg-swept" } as { messageId: string | null }),
  countMetric: vi.fn(),
}));

vi.mock("@/lib/tasks/db", () => ({
  listOverdueActiveTasks: hoisted.listOverdueActiveTasks,
}));

vi.mock("@/lib/tasks/queue/schedule-fire", () => ({
  sendScheduledFire: hoisted.sendScheduledFire,
}));

vi.mock("@/lib/metrics", () => ({
  countMetric: hoisted.countMetric,
}));

const { scheduledTaskSweep } = await import("./index.ts");

function makeRow(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: "task-1",
    userId: "user-1",
    channelId: "ch-1",
    description: "Daily standup",
    scheduleType: ScheduleType.Recurring,
    runAt: null,
    cron: "0 9 * * *",
    timezone: null,
    action: { type: "message", channelId: "ch-1", content: "standup!" },
    memberRoles: null,
    status: ScheduledTaskStatus.Active,
    nextRunAt: "2026-04-23T13:00:00.000Z",
    queueMessageId: "msg-original",
    lastFiredAt: "2026-04-23T13:00:00.000Z",
    fireCount: 1,
    maxDriftMs: null,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listOverdueActiveTasks.mockResolvedValue([]);
  hoisted.sendScheduledFire.mockResolvedValue({ messageId: "msg-swept" });
  vi.setSystemTime(new Date("2026-04-24T15:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduled-task-sweep", () => {
  it("queries with a cutoff one hour in the past", async () => {
    await scheduledTaskSweep.handle(asAPI(createMockAPI()));
    expect(hoisted.listOverdueActiveTasks).toHaveBeenCalledWith("2026-04-24T14:00:00.000Z");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });

  it("re-enqueues each stale task at its stuck target and emits a metric", async () => {
    hoisted.listOverdueActiveTasks.mockResolvedValue([
      makeRow({ id: "task-1", nextRunAt: "2026-04-23T13:00:00.000Z" }),
      makeRow({
        id: "task-2",
        nextRunAt: "2026-04-24T09:00:00.000Z",
        scheduleType: ScheduleType.Once,
      }),
    ]);

    await scheduledTaskSweep.handle(asAPI(createMockAPI()));

    expect(hoisted.sendScheduledFire.mock.calls).toEqual([
      ["task-1", new Date("2026-04-23T13:00:00.000Z"), 0],
      ["task-2", new Date("2026-04-24T09:00:00.000Z"), 0],
    ]);
    expect(hoisted.countMetric).toHaveBeenCalledWith("scheduled_task.swept", {
      schedule_type: "recurring",
    });
    expect(hoisted.countMetric).toHaveBeenCalledWith("scheduled_task.swept", {
      schedule_type: "once",
    });
  });

  it("skips DuplicateMessageError per task and keeps sweeping", async () => {
    hoisted.listOverdueActiveTasks.mockResolvedValue([
      makeRow({ id: "task-dup" }),
      makeRow({ id: "task-2" }),
    ]);
    hoisted.sendScheduledFire
      .mockRejectedValueOnce(new DuplicateMessageError("duplicate", "task-dup:..."))
      .mockResolvedValueOnce({ messageId: "msg-swept" });

    await scheduledTaskSweep.handle(asAPI(createMockAPI()));

    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(2);
    expect(hoisted.countMetric).toHaveBeenCalledTimes(1);
    expect(hoisted.countMetric).toHaveBeenCalledWith("scheduled_task.swept", {
      schedule_type: "recurring",
    });
  });

  it("attempts every task before surfacing non-duplicate failures", async () => {
    hoisted.listOverdueActiveTasks.mockResolvedValue([
      makeRow({ id: "task-broken" }),
      makeRow({ id: "task-2" }),
    ]);
    hoisted.sendScheduledFire
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce({ messageId: "msg-swept" });

    await expect(scheduledTaskSweep.handle(asAPI(createMockAPI()))).rejects.toThrow(
      "1/2 re-enqueues failed",
    );

    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(2);
    expect(hoisted.countMetric).toHaveBeenCalledWith("scheduled_task.swept", {
      schedule_type: "recurring",
    });
  });
});
