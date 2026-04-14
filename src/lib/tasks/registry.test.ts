import { describe, it, expect, beforeEach, vi } from "vitest";

import type { TaskMeta } from "./types";

const mockRedis = {
  data: new Map<string, unknown>(),
  sets: new Map<string, Set<string>>(),

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  },
  async set(key: string, value: unknown) {
    this.data.set(key, value);
    return "OK";
  },
  async del(key: string) {
    this.data.delete(key);
    return 1;
  },
  async sadd(key: string, ...members: string[]) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    for (const m of members) this.sets.get(key)!.add(m);
    return members.length;
  },
  async smembers<T>(key: string): Promise<T> {
    return [...(this.sets.get(key) ?? [])] as T;
  },
  async srem(key: string, ...members: string[]) {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  },
  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    // eslint-disable-next-line oxclippy/let-and-return -- self-referential object
    const pipe = {
      get: (key: string) => {
        ops.push(() => mockRedis.get(key));
        return pipe;
      },
      exec: async <T>(): Promise<T> => {
        return (await Promise.all(ops.map((fn) => fn()))) as T;
      },
    };
    return pipe;
  },

  reset() {
    this.data.clear();
    this.sets.clear();
  },
};

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => mockRedis },
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
  beforeEach(() => mockRedis.reset());

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
