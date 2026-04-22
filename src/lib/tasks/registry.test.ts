import { describe, it, expect, beforeEach, vi } from "vitest";

import { createRichMemoryRedis } from "@/lib/test/fixtures";

import type { TaskMeta } from "./types";

// Built once at module scope — `registry.ts` memoizes the redis instance it
// gets back from `Redis.fromEnv`, so reassigning between tests would be
// ignored. Reset the data in beforeEach instead.
const redis = createRichMemoryRedis();

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redis },
}));

const { saveTask, getTask, listTasks, removeTask } = await import("./registry");

function makeMeta(overrides?: Partial<TaskMeta>): TaskMeta {
  return {
    id: "task-1",
    description: "Test task",
    action: { type: "message", channelId: "ch-1", content: "hello" },
    schedule: { type: "once", at: "2026-04-09T13:00:00Z" },
    context: { userId: "user-1", channelId: "ch-1" },
    createdAt: "2026-04-08T12:00:00Z",
    ...overrides,
  };
}

describe("task registry", () => {
  beforeEach(() => {
    redis.reset();
  });

  it("saves and retrieves a task", async () => {
    const meta = makeMeta();
    await saveTask(meta);
    const result = await getTask("task-1");
    expect(result).toEqual(meta);
  });

  it("returns null for missing task", async () => {
    expect(await getTask("nonexistent")).toBeNull();
  });

  it("lists all tasks", async () => {
    await saveTask(makeMeta({ id: "t1" }));
    await saveTask(makeMeta({ id: "t2", context: { userId: "user-2", channelId: "ch-1" } }));
    const all = await listTasks();
    expect(all).toHaveLength(2);
  });

  it("lists tasks filtered by userId", async () => {
    await saveTask(makeMeta({ id: "t1", context: { userId: "user-1", channelId: "ch-1" } }));
    await saveTask(makeMeta({ id: "t2", context: { userId: "user-2", channelId: "ch-1" } }));
    const user1 = await listTasks({ userId: "user-1" });
    expect(user1).toHaveLength(1);
    expect(user1[0].id).toBe("t1");
  });

  it("returns empty array when no tasks exist", async () => {
    expect(await listTasks()).toEqual([]);
  });

  it("removes a task from all indexes", async () => {
    await saveTask(makeMeta());
    await removeTask("task-1");
    expect(await getTask("task-1")).toBeNull();
    expect(await listTasks()).toEqual([]);
    expect(await listTasks({ userId: "user-1" })).toEqual([]);
  });

  it("removeTask is a no-op for missing task", async () => {
    await removeTask("nonexistent"); // should not throw
  });
});
