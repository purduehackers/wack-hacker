import { tool } from "ai";
import { z } from "zod";

const todoItemSchema = z.object({
  id: z.string().min(1).describe("Stable identifier for this todo"),
  content: z.string().min(1).describe("What needs to be done"),
  status: z.enum(["todo", "in_progress", "completed"]).describe("Current state"),
});

export const todo_write = tool({
  description: `Create and maintain a structured plan for the current task. Pass the full, updated list on every call — this tool REPLACES the prior list (it doesn't merge).

Use this when the task has 3+ meaningful steps. Mark exactly one todo as \`in_progress\` at a time. Mark todos \`completed\` as soon as the underlying work is verified (tests passing, file saved, etc.) — do not batch completions.

The list stays visible in the tool-call history, so you can re-read it at any point without persisting it elsewhere.`,
  inputSchema: z.object({
    todos: z
      .array(todoItemSchema)
      .describe("The complete list of todos. Replaces the previous list entirely."),
  }),
  execute: async ({ todos }) => {
    const inProgress = todos.filter((t) => t.status === "in_progress").length;
    return JSON.stringify({
      success: true,
      count: todos.length,
      in_progress_count: inProgress,
      warning:
        inProgress > 1
          ? "More than one todo is in_progress — keep exactly one at a time."
          : undefined,
      todos,
    });
  },
});
