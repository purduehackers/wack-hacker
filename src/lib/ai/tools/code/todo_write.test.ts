import { describe, expect, it } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

import { todo_write } from "./todo_write.ts";

function call(input: Parameters<NonNullable<typeof todo_write.execute>>[0]) {
  return todo_write.execute!(input, toolOpts);
}

describe("todo_write tool", () => {
  it("echoes back the todo list with counts", async () => {
    const raw = await call({
      todos: [
        { id: "1", content: "Scope the task", status: "completed" },
        { id: "2", content: "Edit the file", status: "in_progress" },
        { id: "3", content: "Run checks", status: "todo" },
      ],
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(3);
    expect(parsed.in_progress_count).toBe(1);
    expect(parsed.warning).toBeUndefined();
    expect(parsed.todos).toHaveLength(3);
  });

  it("warns when more than one todo is in_progress", async () => {
    const raw = await call({
      todos: [
        { id: "1", content: "A", status: "in_progress" },
        { id: "2", content: "B", status: "in_progress" },
      ],
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.warning).toMatch(/exactly one at a time/);
  });

  it("validates the schema (status enum)", () => {
    const schema = todo_write.inputSchema as unknown as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ todos: [{ id: "1", content: "a", status: "done" }] }).success).toBe(
      false,
    );
  });
});
