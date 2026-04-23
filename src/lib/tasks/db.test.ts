import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewScheduledTask } from "./types.ts";

import { ScheduledTaskStatus, ScheduleType } from "./enums.ts";

// Route libsql to an in-memory SQLite so drizzle hits a real (ephemeral) DB.
const { memoryClient } = await vi.hoisted(async () => {
  const actual = await import("@libsql/client");
  return { memoryClient: actual.createClient({ url: "file::memory:?cache=shared" }) };
});

vi.mock("@libsql/client", async () => {
  const actual = await vi.importActual<typeof import("@libsql/client")>("@libsql/client");
  return {
    ...actual,
    createClient: vi.fn(() => memoryClient),
  };
});

const { getDb } = await import("../db/index.ts");
const { scheduledTasks } = await import("../db/schemas/scheduled-tasks.ts");
const { saveScheduledTask, getScheduledTask, updateScheduledTask, listScheduledTasks, claimFire } =
  await import("./db.ts");

beforeAll(async () => {
  const migrationsDir = "./drizzle";
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrationFiles) {
    const raw = readFileSync(join(migrationsDir, migration), "utf-8");
    for (const statement of raw.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await memoryClient.execute(trimmed);
    }
  }
});

beforeEach(async () => {
  await getDb().delete(scheduledTasks);
});

function makeRow(overrides: Partial<NewScheduledTask> = {}): NewScheduledTask {
  return {
    id: "task-1",
    userId: "user-1",
    channelId: "ch-1",
    description: "Daily standup reminder",
    scheduleType: ScheduleType.Recurring,
    runAt: null,
    cron: "0 9 * * 1-5",
    timezone: "America/New_York",
    action: { type: "message", channelId: "ch-1", content: "standup in 5" },
    memberRoles: ["1012751663322382438"],
    status: ScheduledTaskStatus.Active,
    nextRunAt: "2026-04-23T13:00:00.000Z",
    queueMessageId: "msg-abc",
    ...overrides,
  };
}

describe("saveScheduledTask + getScheduledTask", () => {
  it("inserts a row and returns it unchanged", async () => {
    await saveScheduledTask(makeRow());
    const row = await getScheduledTask("task-1");
    expect(row).toMatchObject({
      id: "task-1",
      userId: "user-1",
      scheduleType: "recurring",
      cron: "0 9 * * 1-5",
      action: { type: "message", channelId: "ch-1", content: "standup in 5" },
      memberRoles: ["1012751663322382438"],
      status: "active",
      nextRunAt: "2026-04-23T13:00:00.000Z",
      queueMessageId: "msg-abc",
      fireCount: 0,
    });
  });

  it("returns null for a missing task", async () => {
    expect(await getScheduledTask("does-not-exist")).toBeNull();
  });

  it("round-trips a one-time message task with null cron/memberRoles", async () => {
    await saveScheduledTask(
      makeRow({
        id: "task-2",
        scheduleType: ScheduleType.Once,
        runAt: "2026-05-01T12:00:00.000Z",
        cron: null,
        memberRoles: null,
        nextRunAt: "2026-05-01T12:00:00.000Z",
      }),
    );
    const row = await getScheduledTask("task-2");
    expect(row?.scheduleType).toBe(ScheduleType.Once);
    expect(row?.runAt).toBe("2026-05-01T12:00:00.000Z");
    expect(row?.cron).toBeNull();
    expect(row?.memberRoles).toBeNull();
  });
});

describe("updateScheduledTask", () => {
  beforeEach(async () => {
    await saveScheduledTask(makeRow());
  });

  it("patches only the supplied columns", async () => {
    await updateScheduledTask("task-1", { status: ScheduledTaskStatus.Cancelled, nextRunAt: null });
    const row = await getScheduledTask("task-1");
    expect(row?.status).toBe(ScheduledTaskStatus.Cancelled);
    expect(row?.nextRunAt).toBeNull();
    // Other columns stay intact.
    expect(row?.description).toBe("Daily standup reminder");
    expect(row?.cron).toBe("0 9 * * 1-5");
  });

  it("updates numeric columns and timestamps", async () => {
    await updateScheduledTask("task-1", {
      fireCount: 3,
      maxDriftMs: 2400,
      lastFiredAt: "2026-04-23T13:00:05.000Z",
    });
    const row = await getScheduledTask("task-1");
    expect(row?.fireCount).toBe(3);
    expect(row?.maxDriftMs).toBe(2400);
    expect(row?.lastFiredAt).toBe("2026-04-23T13:00:05.000Z");
  });

  it("is a no-op when the patch is empty", async () => {
    const before = await getScheduledTask("task-1");
    await updateScheduledTask("task-1", {});
    const after = await getScheduledTask("task-1");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("bumps updatedAt when writing", async () => {
    const before = await getScheduledTask("task-1");
    await new Promise((r) => setTimeout(r, 10));
    await updateScheduledTask("task-1", { fireCount: 1 });
    const after = await getScheduledTask("task-1");
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });
});

describe("claimFire", () => {
  beforeEach(async () => {
    await saveScheduledTask(makeRow());
  });

  it("claims the first attempt and bumps fireCount + lastFiredAt", async () => {
    const claimed = await claimFire("task-1", "2026-04-23T13:00:00.000Z");
    expect(claimed).toBe(true);
    const row = await getScheduledTask("task-1");
    expect(row?.lastFiredAt).toBe("2026-04-23T13:00:00.000Z");
    expect(row?.fireCount).toBe(1);
  });

  it("rejects a second claim for the same target (retry after partial success)", async () => {
    expect(await claimFire("task-1", "2026-04-23T13:00:00.000Z")).toBe(true);
    expect(await claimFire("task-1", "2026-04-23T13:00:00.000Z")).toBe(false);
    const row = await getScheduledTask("task-1");
    expect(row?.fireCount).toBe(1);
  });

  it("accepts a claim for a newer target even after a previous claim", async () => {
    expect(await claimFire("task-1", "2026-04-23T13:00:00.000Z")).toBe(true);
    expect(await claimFire("task-1", "2026-04-24T13:00:00.000Z")).toBe(true);
    const row = await getScheduledTask("task-1");
    expect(row?.lastFiredAt).toBe("2026-04-24T13:00:00.000Z");
    expect(row?.fireCount).toBe(2);
  });

  it("refuses to claim cancelled rows", async () => {
    await updateScheduledTask("task-1", { status: ScheduledTaskStatus.Cancelled });
    expect(await claimFire("task-1", "2026-04-23T13:00:00.000Z")).toBe(false);
  });

  it("returns false when the row doesn't exist", async () => {
    expect(await claimFire("ghost", "2026-04-23T13:00:00.000Z")).toBe(false);
  });
});

describe("listScheduledTasks", () => {
  beforeEach(async () => {
    await saveScheduledTask(makeRow({ id: "a" }));
    await saveScheduledTask(makeRow({ id: "b", userId: "user-2" }));
    await saveScheduledTask(makeRow({ id: "c", status: ScheduledTaskStatus.Cancelled }));
    await saveScheduledTask(makeRow({ id: "d", status: ScheduledTaskStatus.Completed }));
  });

  it("returns only active tasks by default", async () => {
    const rows = await listScheduledTasks();
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("filters by userId", async () => {
    const rows = await listScheduledTasks({ userId: "user-1" });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns an empty array when nothing matches the user filter", async () => {
    const rows = await listScheduledTasks({ userId: "someone-else" });
    expect(rows).toEqual([]);
  });
});
