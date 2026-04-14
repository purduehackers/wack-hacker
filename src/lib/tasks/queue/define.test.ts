import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { TaskHandler } from "./types.ts";

import { defineTask } from "./define.ts";

describe("defineTask", () => {
  it("returns the task object unchanged for runtime identity", () => {
    const handler: TaskHandler<{ id: string }> = {
      name: "noop",
      schema: z.object({ id: z.string() }),
      handle: async () => {},
    };
    expect(defineTask(handler)).toBe(handler);
  });

  it("preserves name and schema", () => {
    const task = defineTask({
      name: "echo",
      schema: z.object({ value: z.number() }),
      handle: async () => {},
    });
    expect(task.name).toBe("echo");
    expect(task.schema.parse({ value: 5 })).toEqual({ value: 5 });
  });
});
