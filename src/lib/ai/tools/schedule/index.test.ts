import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduledTaskRow } from "@/lib/tasks/types";

import { ScheduledTaskStatus, ScheduleType } from "@/lib/tasks/enums";
import { messagePacket, toolOpts } from "@/lib/test/fixtures";

const hoisted = vi.hoisted(() => ({
  sendScheduledFire: vi
    .fn()
    .mockResolvedValue({ messageId: "msg-queue-1" } as { messageId: string | null }),
  saveScheduledTask: vi.fn().mockResolvedValue(undefined),
  updateScheduledTask: vi.fn().mockResolvedValue(undefined),
  listScheduledTasks: vi.fn<() => Promise<ScheduledTaskRow[]>>().mockResolvedValue([]),
}));

vi.mock("@/lib/tasks/queue/schedule-fire", () => ({
  sendScheduledFire: hoisted.sendScheduledFire,
}));

vi.mock("@/lib/tasks/db", () => ({
  saveScheduledTask: hoisted.saveScheduledTask,
  getScheduledTask: vi.fn(),
  updateScheduledTask: hoisted.updateScheduledTask,
  listScheduledTasks: hoisted.listScheduledTasks,
}));

const { AgentContext } = await import("../../context.ts");
const { hasApprovalMarker } = await import("../../approvals/index.ts");
const { createScheduleTask, list_scheduled_tasks, cancel_task } = await import("./index.ts");

type AgentContextInstance = Awaited<ReturnType<typeof AgentContext.fromPacket>>;

function contextWithRoles(memberRoles?: string[]): AgentContextInstance {
  return AgentContext.fromPacket(messagePacket("hello", { memberRoles }));
}

function futureISO(): string {
  return new Date(Date.now() + 3600_000).toISOString();
}

function makeRow(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: "row-1",
    userId: "user-1",
    channelId: "ch-1",
    description: "Daily standup",
    scheduleType: ScheduleType.Recurring,
    runAt: null,
    cron: "0 9 * * 1-5",
    timezone: null,
    action: { type: "message", channelId: "ch-1", content: "standup" },
    memberRoles: null,
    status: ScheduledTaskStatus.Active,
    nextRunAt: "2026-04-24T13:00:00.000Z",
    queueMessageId: "msg-1",
    lastFiredAt: null,
    fireCount: 0,
    maxDriftMs: null,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.sendScheduledFire.mockResolvedValue({ messageId: "msg-queue-1" });
  hoisted.saveScheduledTask.mockResolvedValue(undefined);
  hoisted.updateScheduledTask.mockResolvedValue(undefined);
  hoisted.listScheduledTasks.mockResolvedValue([]);
});

describe("schedule_task: approval markers", () => {
  it("marks schedule_task with approval()", () => {
    expect(hasApprovalMarker(createScheduleTask(contextWithRoles()))).toBe(true);
  });

  it("marks cancel_task with approval()", () => {
    expect(hasApprovalMarker(cancel_task)).toBe(true);
  });

  it("does not mark list_scheduled_tasks (read-only)", () => {
    expect(hasApprovalMarker(list_scheduled_tasks)).toBe(false);
  });
});

describe("schedule_task: successful scheduling", () => {
  it("sends the queue wake-up and inserts a DB row for a one-time task", async () => {
    const schedule_task = createScheduleTask(contextWithRoles(["role-admin"]));
    const runAt = futureISO();
    const result = await schedule_task.execute!(
      {
        description: "Test reminder",
        action_type: "message",
        channel_id: "ch-7",
        content: "Hello!",
        schedule_type: ScheduleType.Once,
        run_at: runAt,
        user_id: "user-42",
      },
      toolOpts,
    );

    expect(result).toContain("Scheduled");
    expect(result).toContain("Test reminder");
    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(1);
    const [taskId, target, delaySec] = hoisted.sendScheduledFire.mock.calls[0];
    expect(taskId).toMatch(/^[0-9A-Z]+$/); // ulid charset
    expect((target as Date).toISOString()).toBe(runAt);
    expect(delaySec).toBeGreaterThan(3500);
    expect(delaySec).toBeLessThanOrEqual(3600);

    expect(hoisted.saveScheduledTask).toHaveBeenCalledTimes(1);
    const [row] = hoisted.saveScheduledTask.mock.calls[0];
    expect(row).toMatchObject({
      id: taskId,
      userId: "user-42",
      channelId: "ch-7",
      description: "Test reminder",
      scheduleType: "once",
      runAt,
      cron: null,
      action: { type: "message", channelId: "ch-7", content: "Hello!" },
      memberRoles: ["role-admin"],
      status: "active",
      nextRunAt: runAt,
      queueMessageId: "msg-queue-1",
    });
  });

  it("enqueues the next occurrence for a recurring task", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Daily standup",
        action_type: "agent",
        channel_id: "ch-1",
        prompt: "summarize yesterday",
        schedule_type: ScheduleType.Recurring,
        cron: "0 9 * * 1-5",
        timezone: "America/New_York",
        user_id: "user-1",
      },
      toolOpts,
    );

    expect(result).toContain("Scheduled");
    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(1);
    expect(hoisted.saveScheduledTask).toHaveBeenCalledTimes(1);
    const [row] = hoisted.saveScheduledTask.mock.calls[0];
    expect(row).toMatchObject({
      scheduleType: "recurring",
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
      action: { type: "agent", channelId: "ch-1", prompt: "summarize yesterday" },
    });
  });

  it("does not insert a row when the queue send throws", async () => {
    hoisted.sendScheduledFire.mockRejectedValueOnce(new Error("queue down"));
    const schedule_task = createScheduleTask(contextWithRoles());
    await expect(
      schedule_task.execute!(
        {
          description: "Test",
          action_type: "message",
          channel_id: "ch-1",
          content: "hi",
          schedule_type: ScheduleType.Once,
          run_at: futureISO(),
          user_id: "user-1",
        },
        toolOpts,
      ),
    ).rejects.toThrow("queue down");
    expect(hoisted.saveScheduledTask).not.toHaveBeenCalled();
  });
});

describe("schedule_task: schedule-shape validation", () => {
  it("rejects past run_at for one-time tasks", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Late task",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: ScheduleType.Once,
        run_at: "2020-01-01T00:00:00Z",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("future");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });

  it("rejects unparseable run_at", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Garbage date",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: ScheduleType.Once,
        run_at: "not-a-date",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("ISO 8601");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });

  it("rejects loose non-ISO date strings", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Loose date",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: ScheduleType.Once,
        run_at: "April 22 2099",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("ISO 8601");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });

  it("rejects invalid cron expression", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Bad cron",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: ScheduleType.Recurring,
        cron: "invalid",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });
});

describe("schedule_task: datetime + timezone validation", () => {
  it("accepts ISO datetime with offset suffix", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const future = new Date(Date.now() + 3600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${future.getUTCFullYear()}-${pad(future.getUTCMonth() + 1)}-${pad(future.getUTCDate())}T${pad(future.getUTCHours())}:${pad(future.getUTCMinutes())}:${pad(future.getUTCSeconds())}+00:00`;
    const result = await schedule_task.execute!(
      {
        description: "Offset ISO",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: ScheduleType.Once,
        run_at: iso,
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Scheduled");
    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid timezone", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Bad timezone",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: ScheduleType.Once,
        run_at: futureISO(),
        timezone: "Not/Real",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("invalid timezone");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });
});

describe("schedule_task: action-body validation", () => {
  it("rejects message action without content", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Empty message",
        action_type: "message",
        channel_id: "ch-1",
        schedule_type: ScheduleType.Once,
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("content is required");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });

  it("rejects agent action without prompt", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Empty agent",
        action_type: "agent",
        channel_id: "ch-1",
        schedule_type: ScheduleType.Once,
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("prompt is required");
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });
});

describe("list_scheduled_tasks", () => {
  it("returns message when no tasks exist", async () => {
    hoisted.listScheduledTasks.mockResolvedValueOnce([]);
    const result = await list_scheduled_tasks.execute!({ user_id: undefined }, toolOpts);
    expect(result).toContain("No active");
  });

  it("formats task list from DB rows", async () => {
    hoisted.listScheduledTasks.mockResolvedValueOnce([
      makeRow({
        id: "row-1",
        description: "Daily standup",
      }),
    ]);
    const result = await list_scheduled_tasks.execute!({ user_id: undefined }, toolOpts);
    expect(result).toContain("Daily standup");
    expect(result).toContain("row-1");
    expect(result).toContain("recurring");
  });

  it("forwards user_id filter to listScheduledTasks", async () => {
    await list_scheduled_tasks.execute!({ user_id: "user-7" }, toolOpts);
    expect(hoisted.listScheduledTasks).toHaveBeenCalledWith({ userId: "user-7" });
  });
});

describe("cancel_task", () => {
  it("updates the DB row and returns confirmation", async () => {
    const result = await cancel_task.execute!({ task_id: "row-1" }, toolOpts);
    expect(result).toContain("row-1");
    expect(result).toContain("cancelled");
    expect(hoisted.updateScheduledTask).toHaveBeenCalledWith("row-1", {
      status: "cancelled",
      nextRunAt: null,
    });
  });
});
