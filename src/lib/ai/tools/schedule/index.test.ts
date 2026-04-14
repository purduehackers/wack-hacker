import { describe, it, expect, vi, beforeEach } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

vi.mock("workflow/api", () => ({
  start: vi.fn().mockResolvedValue({ runId: "run-123" }),
  getRun: vi.fn().mockReturnValue({
    cancel: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/tasks/registry", () => ({
  listTasks: vi.fn().mockResolvedValue([]),
  removeTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/workflows/task", () => ({
  taskWorkflow: vi.fn(),
}));

const workflowApi = await import("workflow/api");
const registry = await import("@/lib/tasks/registry");
const { scheduleTask, listScheduledTasks, cancelTask } = await import("./index.ts");

const mockedStart = workflowApi.start as ReturnType<typeof vi.fn>;
const mockedListTasks = registry.listTasks as ReturnType<typeof vi.fn>;

describe("scheduleTask tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("schedules a one-time message task", async () => {
    mockedStart.mockResolvedValueOnce({ runId: "run-abc" } as never);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const result = await scheduleTask.execute!(
      {
        description: "Test reminder",
        action_type: "message",
        channel_id: "ch-1",
        content: "Hello!",
        schedule_type: "once",
        run_at: future,
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("run-abc");
    expect(result).toContain("Test reminder");
  });

  it("schedules a recurring agent task", async () => {
    mockedStart.mockResolvedValueOnce({ runId: "run-cron" } as never);
    const result = await scheduleTask.execute!(
      {
        description: "Daily standup",
        action_type: "agent",
        channel_id: "ch-1",
        prompt: "Summarize today",
        schedule_type: "recurring",
        cron: "0 9 * * 1-5",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("run-cron");
    expect(result).toContain("Daily standup");
  });

  it("rejects past run_at for one-time tasks", async () => {
    const result = await scheduleTask.execute!(
      {
        description: "Late task",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: "once",
        run_at: "2020-01-01T00:00:00Z",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("future");
  });

  it("rejects invalid cron expression", async () => {
    const result = await scheduleTask.execute!(
      {
        description: "Bad cron",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: "recurring",
        cron: "invalid",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
  });
});

describe("listScheduledTasks tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns message when no tasks exist", async () => {
    mockedListTasks.mockResolvedValueOnce([]);
    const result = await listScheduledTasks.execute!({ user_id: undefined }, toolOpts);
    expect(result).toContain("No active");
  });

  it("formats task list", async () => {
    mockedListTasks.mockResolvedValueOnce([
      {
        id: "run-1",
        description: "Daily standup",
        action: { type: "message", channelId: "ch-1", content: "hi" },
        schedule: { type: "recurring", cron: "0 9 * * *" },
        context: { userId: "user-1", channelId: "ch-1" },
        createdAt: "2026-04-08T00:00:00Z",
      },
    ]);
    const result = await listScheduledTasks.execute!({ user_id: undefined }, toolOpts);
    expect(result).toContain("Daily standup");
    expect(result).toContain("run-1");
    expect(result).toContain("recurring");
  });
});

describe("cancelTask tool", () => {
  it("returns confirmation", async () => {
    const result = await cancelTask.execute!({ task_id: "run-123" }, toolOpts);
    expect(result).toContain("run-123");
    expect(result).toContain("cancelled");
  });
});
