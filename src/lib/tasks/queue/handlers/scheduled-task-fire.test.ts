import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduledTaskRow } from "@/lib/tasks/types";

import { ScheduledTaskStatus, ScheduleType } from "@/lib/tasks/enums";
import {
  asAPI,
  createMockAPI,
  discordRESTClass,
  installMockProvider,
  linearClientClass,
  notionClientClass,
  octokitClass,
  resendClass,
  streamingTextModel,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

// `streamTurn` transitively loads real tool modules that instantiate SDK
// clients at import time. Neutralize those clients with the fixture class
// stubs so the test doesn't need live credentials.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const hoisted = vi.hoisted(() => ({
  sendScheduledFire: vi
    .fn()
    .mockResolvedValue({ messageId: "msg-next" } as { messageId: string | null }),
  getScheduledTask: vi.fn<(id: string) => Promise<ScheduledTaskRow | null>>(),
  updateScheduledTask: vi.fn().mockResolvedValue(undefined),
  claimFire: vi.fn<(id: string, targetIso: string) => Promise<boolean>>().mockResolvedValue(true),
  recordDistribution: vi.fn(),
  countMetric: vi.fn(),
}));

vi.mock("../schedule-fire.ts", () => ({
  sendScheduledFire: hoisted.sendScheduledFire,
}));

vi.mock("@/lib/tasks/db", () => ({
  getScheduledTask: hoisted.getScheduledTask,
  updateScheduledTask: hoisted.updateScheduledTask,
  claimFire: hoisted.claimFire,
}));

vi.mock("@/lib/metrics", () => ({
  recordDistribution: hoisted.recordDistribution,
  countMetric: hoisted.countMetric,
  recordDuration: vi.fn(),
}));

const { scheduledTaskFire } = await import("./scheduled-task-fire.ts");

function makeRow(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: "task-1",
    userId: "user-1",
    channelId: "ch-1",
    description: "Daily standup",
    scheduleType: ScheduleType.Once,
    runAt: "2026-04-23T13:00:00.000Z",
    cron: null,
    timezone: null,
    action: { type: "message", channelId: "ch-1", content: "standup!" },
    memberRoles: null,
    status: ScheduledTaskStatus.Active,
    nextRunAt: "2026-04-23T13:00:00.000Z",
    queueMessageId: "msg-original",
    lastFiredAt: null,
    fireCount: 0,
    maxDriftMs: null,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.sendScheduledFire.mockResolvedValue({ messageId: "msg-next" });
  hoisted.updateScheduledTask.mockResolvedValue(undefined);
  hoisted.claimFire.mockResolvedValue(true);
  vi.setSystemTime(new Date("2026-04-23T13:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduled-task-fire: validation + short-circuits", () => {
  it("validates payload shape", () => {
    expect(
      scheduledTaskFire.schema.safeParse({ taskId: "x", targetIso: "2026-01-01T00:00Z" }).success,
    ).toBe(true);
    expect(scheduledTaskFire.schema.safeParse({ taskId: 5 }).success).toBe(false);
  });

  it("no-ops when the row is missing", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(null);
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "ghost", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );
    expect(discord.callsTo("channels.createMessage")).toEqual([]);
    expect(hoisted.updateScheduledTask).not.toHaveBeenCalled();
  });

  it("no-ops when status is not active", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({ status: ScheduledTaskStatus.Cancelled }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );
    expect(discord.callsTo("channels.createMessage")).toEqual([]);
    expect(hoisted.updateScheduledTask).not.toHaveBeenCalled();
  });

  it("no-ops when the row's nextRunAt is ahead of the delivered targetIso (superseded)", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({ nextRunAt: "2026-04-30T13:00:00.000Z" }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );
    expect(discord.callsTo("channels.createMessage")).toEqual([]);
    expect(hoisted.updateScheduledTask).not.toHaveBeenCalled();
  });

  it("still fires when the row's nextRunAt is behind the delivered targetIso (partial-write recovery)", async () => {
    // A prior recurring iteration's `send` succeeded but the row update
    // failed — the queue is carrying the new target while the row still
    // reflects the old one. The handler must honor the new message so the
    // recurring chain self-heals instead of silently halting.
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({
        scheduleType: ScheduleType.Recurring,
        runAt: null,
        cron: "0 9 * * *",
        timezone: "America/New_York",
        nextRunAt: "2026-04-22T13:00:00.000Z",
      }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );
    expect(discord.callsTo("channels.createMessage").length).toBeGreaterThan(0);
    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(1);
  });
});

describe("scheduled-task-fire: checkpoint hop", () => {
  it("re-enqueues remaining time and skips action when delivered early", async () => {
    // targetIso is 10 days out but we're delivered at the 6-day checkpoint.
    const targetIso = "2026-05-03T13:00:00.000Z"; // 10 days after the mocked "now"
    vi.setSystemTime(new Date("2026-04-29T13:00:00.000Z")); // 4 days before the real target
    hoisted.getScheduledTask.mockResolvedValueOnce(makeRow({ nextRunAt: targetIso }));

    const discord = createMockAPI();
    await scheduledTaskFire.handle({ taskId: "task-1", targetIso }, asAPI(discord));

    expect(discord.callsTo("channels.createMessage")).toEqual([]);
    expect(hoisted.sendScheduledFire).toHaveBeenCalledWith(
      "task-1",
      expect.any(Date),
      expect.any(Number),
    );
    const [, , remainingSec] = hoisted.sendScheduledFire.mock.calls[0];
    expect(remainingSec).toBe(4 * 24 * 3600); // exactly 4 days remaining
    expect(hoisted.updateScheduledTask).toHaveBeenCalledWith("task-1", {
      queueMessageId: "msg-next",
    });
    expect(hoisted.recordDistribution).not.toHaveBeenCalled();
  });
});

describe("scheduled-task-fire: once → completed", () => {
  it("posts the message and marks completed", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({
        action: { type: "message", channelId: "ch-7", content: "standup time!" },
      }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );

    expect(discord.callsTo("channels.createMessage")).toEqual([
      ["ch-7", { content: expect.stringContaining("standup time!") }],
    ]);
    const [call] = discord.callsTo("channels.createMessage");
    expect((call[1] as { content: string }).content).toContain("-# Task: task-1");

    expect(hoisted.recordDistribution).toHaveBeenCalledWith(
      "scheduled_task.fire_drift_ms",
      0,
      expect.objectContaining({ schedule_type: "once", action_type: "message" }),
    );
    expect(hoisted.claimFire).toHaveBeenCalledWith("task-1", "2026-04-23T13:00:00.000Z");
    expect(hoisted.updateScheduledTask).toHaveBeenCalledWith("task-1", {
      status: "completed",
      nextRunAt: null,
      queueMessageId: null,
      maxDriftMs: 0,
    });
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });

  it("no-ops when the row exists but claimFire returns false (retry after partial success)", async () => {
    // Scenario: the first delivery posted the Discord message and threw
    // before advancing nextRunAt. The route released the dedup marker so
    // the queue retries — but claimFire has already bumped lastFiredAt for
    // this target, so the retry must NOT run the action again.
    hoisted.getScheduledTask.mockResolvedValueOnce(makeRow());
    hoisted.claimFire.mockResolvedValueOnce(false);

    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );

    expect(discord.callsTo("channels.createMessage")).toEqual([]);
    expect(hoisted.updateScheduledTask).not.toHaveBeenCalled();
    expect(hoisted.recordDistribution).not.toHaveBeenCalled();
  });

  it("surfaces action errors and records the error metric", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(makeRow());
    const discord = createMockAPI();
    discord.channels.createMessage = async () => {
      throw new Error("discord exploded");
    };

    await expect(
      scheduledTaskFire.handle(
        { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
        asAPI(discord),
      ),
    ).rejects.toThrow("discord exploded");

    expect(hoisted.countMetric).toHaveBeenCalledWith(
      "scheduled_task.action_error",
      expect.objectContaining({ schedule_type: "once", action_type: "message" }),
    );
    // Row stays untouched so the next redelivery can see the original state.
    expect(hoisted.updateScheduledTask).not.toHaveBeenCalled();
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });
});

describe("scheduled-task-fire: recurring → re-enqueue", () => {
  it("fires once and enqueues the next occurrence (null timezone → default)", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({
        scheduleType: ScheduleType.Recurring,
        runAt: null,
        cron: "0 9 * * *",
        timezone: null,
        fireCount: 2,
        maxDriftMs: 150,
      }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );

    expect(discord.callsTo("channels.createMessage").length).toBeGreaterThan(0);
    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(1);
    const [taskId, nextDate] = hoisted.sendScheduledFire.mock.calls[0];
    expect(taskId).toBe("task-1");
    // Next 9 AM America/New_York after 9 AM EDT on 2026-04-23 is 9 AM EDT 2026-04-24 (13:00 UTC).
    expect((nextDate as Date).toISOString()).toBe("2026-04-24T13:00:00.000Z");

    expect(hoisted.updateScheduledTask).toHaveBeenCalledWith("task-1", {
      nextRunAt: "2026-04-24T13:00:00.000Z",
      queueMessageId: "msg-next",
      maxDriftMs: 150,
    });
  });

  it("skips missed intervals when firing late (next occurrence is already in the past)", async () => {
    // Minutely cron scheduled at 13:00:00Z. We fire 10 minutes late at
    // 13:10:00Z. The next occurrence anchored to the target is 13:01:00Z —
    // still 9 minutes in the past. The handler must advance to the next
    // future slot (13:11:00Z) instead of enqueuing 10 back-to-back fires.
    vi.setSystemTime(new Date("2026-04-23T13:10:00.000Z"));
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({
        scheduleType: ScheduleType.Recurring,
        runAt: null,
        cron: "* * * * *",
        timezone: "America/New_York",
      }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );

    expect(hoisted.sendScheduledFire).toHaveBeenCalledTimes(1);
    const [, nextDate] = hoisted.sendScheduledFire.mock.calls[0];
    expect((nextDate as Date).toISOString()).toBe("2026-04-23T13:11:00.000Z");
    expect(hoisted.countMetric).toHaveBeenCalledWith("scheduled_task.recurring_intervals_skipped");
  });

  it("marks status=failed when the cron expression fails to parse on re-enqueue", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({
        scheduleType: ScheduleType.Recurring,
        runAt: null,
        cron: "bogus",
        timezone: "America/New_York",
      }),
    );
    const discord = createMockAPI();
    await expect(
      scheduledTaskFire.handle(
        { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
        asAPI(discord),
      ),
    ).rejects.toThrow();

    expect(hoisted.updateScheduledTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "failed", nextRunAt: null, queueMessageId: null }),
    );
    // Should not have `fireCount` or `lastFiredAt` — claimFire owns those.
    expect(hoisted.updateScheduledTask).toHaveBeenCalledWith(
      "task-1",
      expect.not.objectContaining({ fireCount: expect.anything() }),
    );
    expect(hoisted.sendScheduledFire).not.toHaveBeenCalled();
  });
});

describe("scheduled-task-fire: agent action", () => {
  beforeEach(() => {
    installMockProvider(streamingTextModel("Agent reply."));
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("runs streamTurn for an agent action and tags the message with the task id", async () => {
    hoisted.getScheduledTask.mockResolvedValueOnce(
      makeRow({
        action: { type: "agent", channelId: "ch-9", prompt: "summarize today" },
      }),
    );
    const discord = createMockAPI();
    await scheduledTaskFire.handle(
      { taskId: "task-1", targetIso: "2026-04-23T13:00:00.000Z" },
      asAPI(discord),
    );

    const bodies = [
      ...discord.callsTo("channels.createMessage").map((c) => c[1] as { content: string }),
      ...discord.callsTo("channels.editMessage").map((c) => c[2] as { content: string }),
    ];
    expect(bodies.some((b) => b.content.includes("-# Task: task-1"))).toBe(true);
  });
});
