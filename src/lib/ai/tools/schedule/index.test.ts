import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRichMemoryRedis,
  discordRESTClass,
  linearClientClass,
  messagePacket,
  notionClientClass,
  octokitClass,
  resendClass,
  toolOpts,
} from "@/lib/test/fixtures";

const hoisted = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue({ runId: "run-123" }),
  cancel: vi.fn().mockResolvedValue(undefined),
}));

// `tasks/registry.ts` memoizes the redis instance from `Redis.fromEnv()` on
// first use (`redis ??= ...`), so we keep the same fixture instance across
// every test and rely on `reset()` in beforeEach to wipe state.
const redis = createRichMemoryRedis();

vi.mock("workflow/api", () => ({
  start: hoisted.start,
  getRun: vi.fn().mockReturnValue({ cancel: hoisted.cancel }),
}));

vi.mock("workflow", () => ({
  sleep: vi.fn(),
  getWorkflowMetadata: vi.fn(() => ({ workflowRunId: "task-run-test" })),
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redis },
}));

// Third-party SDK mocks — schedule/index.ts transitively loads workflows/task,
// which imports tool modules that instantiate SDK clients at import time.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@discordjs/core/http-only", () => ({
  API: class MockAPI {
    channels = { createMessage: vi.fn() };
  },
}));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { AgentContext } = await import("../../context.ts");
const { hasApprovalMarker } = await import("../../approvals/index.ts");
const { createScheduleTask, list_scheduled_tasks, cancel_task } = await import("./index.ts");
const { saveTask } = await import("../../../tasks/registry.ts");

type AgentContextInstance = Awaited<ReturnType<typeof AgentContext.fromPacket>>;

function contextWithRoles(memberRoles?: string[]): AgentContextInstance {
  return AgentContext.fromPacket(messagePacket("hello", { memberRoles }));
}

function futureISO(): string {
  return new Date(Date.now() + 3600_000).toISOString();
}

type PersistedMeta = { meta: { context: { memberRoles?: string[] } } };

function lastScheduledMeta(): PersistedMeta["meta"] {
  const [, args] = hoisted.start.mock.calls[0];
  return (args as [PersistedMeta])[0].meta;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.start.mockResolvedValue({ runId: "run-123" });
  hoisted.cancel.mockResolvedValue(undefined);
  redis.reset();
});

describe("schedule_task tool: approval marker", () => {
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

describe("schedule_task tool: scheduling", () => {
  it("schedules a one-time message task", async () => {
    hoisted.start.mockResolvedValueOnce({ runId: "run-abc" });
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Test reminder",
        action_type: "message",
        channel_id: "ch-1",
        content: "Hello!",
        schedule_type: "once",
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("run-abc");
    expect(result).toContain("Test reminder");
  });

  it("schedules a recurring agent task", async () => {
    hoisted.start.mockResolvedValueOnce({ runId: "run-cron" });
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
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
});

describe("schedule_task tool: memberRoles propagation", () => {
  it("propagates scheduler's memberRoles into persisted task meta", async () => {
    const schedule_task = createScheduleTask(contextWithRoles(["role-admin", "role-organizer"]));
    await schedule_task.execute!(
      {
        description: "Role-aware task",
        action_type: "agent",
        channel_id: "ch-1",
        prompt: "do a thing",
        schedule_type: "once",
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );

    expect(hoisted.start).toHaveBeenCalledOnce();
    expect(lastScheduledMeta().context.memberRoles).toEqual(["role-admin", "role-organizer"]);
  });

  it("stores undefined memberRoles when scheduler has none", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    await schedule_task.execute!(
      {
        description: "Public task",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: "once",
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );

    expect(lastScheduledMeta().context.memberRoles).toBeUndefined();
  });
});

describe("schedule_task tool: schedule-shape validation", () => {
  it("rejects past run_at for one-time tasks", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
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
    expect(hoisted.start).not.toHaveBeenCalled();
  });

  it("rejects unparseable run_at", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Garbage date",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: "once",
        run_at: "not-a-date",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("ISO 8601");
    expect(hoisted.start).not.toHaveBeenCalled();
  });

  it("rejects loose non-ISO date strings", async () => {
    // `new Date("April 22 2099")` parses successfully in V8 but isn't ISO 8601;
    // the old `isNaN` check let it through and the error message lied.
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Loose date",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: "once",
        run_at: "April 22 2099",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("ISO 8601");
    expect(hoisted.start).not.toHaveBeenCalled();
  });

  it("rejects invalid cron expression", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
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
    expect(hoisted.start).not.toHaveBeenCalled();
  });
});

describe("schedule_task tool: datetime + timezone validation", () => {
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
        schedule_type: "once",
        run_at: iso,
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Scheduled");
    expect(hoisted.start).toHaveBeenCalledOnce();
  });

  it("rejects invalid timezone", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Bad timezone",
        action_type: "message",
        channel_id: "ch-1",
        content: "hi",
        schedule_type: "once",
        run_at: futureISO(),
        timezone: "Not/Real",
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("invalid timezone");
    expect(hoisted.start).not.toHaveBeenCalled();
  });
});

describe("schedule_task tool: action-body validation", () => {
  it("rejects message action without content", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Empty message",
        action_type: "message",
        channel_id: "ch-1",
        schedule_type: "once",
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("content is required");
    expect(hoisted.start).not.toHaveBeenCalled();
  });

  it("rejects message action with whitespace-only content", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Whitespace message",
        action_type: "message",
        channel_id: "ch-1",
        content: "   ",
        schedule_type: "once",
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("content is required");
    expect(hoisted.start).not.toHaveBeenCalled();
  });

  it("rejects agent action without prompt", async () => {
    const schedule_task = createScheduleTask(contextWithRoles());
    const result = await schedule_task.execute!(
      {
        description: "Empty agent",
        action_type: "agent",
        channel_id: "ch-1",
        schedule_type: "once",
        run_at: futureISO(),
        user_id: "user-1",
      },
      toolOpts,
    );
    expect(result).toContain("Error");
    expect(result).toContain("prompt is required");
    expect(hoisted.start).not.toHaveBeenCalled();
  });
});

describe("list_scheduled_tasks tool", () => {
  it("returns message when no tasks exist", async () => {
    const result = await list_scheduled_tasks.execute!({ user_id: undefined }, toolOpts);
    expect(result).toContain("No active");
  });

  it("formats task list", async () => {
    await saveTask({
      id: "run-1",
      description: "Daily standup",
      action: { type: "message", channelId: "ch-1", content: "hi" },
      schedule: { type: "recurring", cron: "0 9 * * *" },
      context: { userId: "user-1", channelId: "ch-1" },
      createdAt: "2026-04-08T00:00:00Z",
    });
    const result = await list_scheduled_tasks.execute!({ user_id: undefined }, toolOpts);
    expect(result).toContain("Daily standup");
    expect(result).toContain("run-1");
    expect(result).toContain("recurring");
  });
});

describe("cancel_task tool", () => {
  it("returns confirmation", async () => {
    const result = await cancel_task.execute!({ task_id: "run-123" }, toolOpts);
    expect(result).toContain("run-123");
    expect(result).toContain("cancelled");
  });
});
