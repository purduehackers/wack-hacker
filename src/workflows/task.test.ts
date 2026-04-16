import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateMessage = vi.fn(async (_ch: string, body: { content: string }) => ({
  id: "msg-1",
  content: body.content,
  channel_id: _ch,
}));

vi.mock("@discordjs/core/http-only", () => {
  class MockAPI {
    channels = { createMessage: mockCreateMessage };
  }
  return { API: MockAPI };
});

vi.mock("@discordjs/rest", () => {
  class MockREST {
    setToken() {
      return this;
    }
  }
  return { REST: MockREST };
});

vi.mock("workflow", () => ({
  sleep: vi.fn(),
  getWorkflowMetadata: vi.fn(() => ({ workflowRunId: "task-run-42" })),
}));

vi.mock("@/lib/tasks/registry", () => ({
  saveTask: vi.fn(),
  removeTask: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock("@/lib/tasks/cron", () => ({
  nextOccurrence: vi.fn(() => new Date(Date.now() + 60_000)),
}));

vi.mock("@/lib/ai/streaming", () => ({
  streamTurn: vi.fn(async () => ({ text: "Agent reply." })),
  truncateWithFooter: vi.fn((text: string, footer: string) => `${text}\n\n${footer}`),
}));

const { taskWorkflow } = await import("./task.ts");
const streaming = await import("@/lib/ai/streaming");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("taskWorkflow: message action footer", () => {
  it("includes task ID footer for message actions", async () => {
    const { saveTask } = await import("@/lib/tasks/registry");

    await taskWorkflow({
      meta: {
        description: "Daily reminder",
        action: { type: "message", channelId: "ch-1", content: "Hello!" },
        schedule: { type: "once", at: new Date(Date.now() + 60_000).toISOString() },
        context: { userId: "u-1", channelId: "ch-1" },
        createdAt: new Date().toISOString(),
      },
    });

    expect(saveTask).toHaveBeenCalled();
    expect(mockCreateMessage).toHaveBeenCalledOnce();

    const [channelId, body] = mockCreateMessage.mock.calls[0];
    expect(channelId).toBe("ch-1");
    expect(body.content).toContain("Hello!");
    expect(body.content).toContain("-# Task: task-run-42");
  });
});

describe("taskWorkflow: agent action footer", () => {
  it("passes task ID to streamTurn for agent actions", async () => {
    await taskWorkflow({
      meta: {
        description: "Daily summary",
        action: { type: "agent", channelId: "ch-1", prompt: "Summarize today" },
        schedule: { type: "once", at: new Date(Date.now() + 60_000).toISOString() },
        context: { userId: "u-1", channelId: "ch-1" },
        createdAt: new Date().toISOString(),
      },
    });

    expect(streaming.streamTurn).toHaveBeenCalledWith(
      expect.anything(), // discord API
      "ch-1",
      "Summarize today",
      expect.any(Object), // serialized context
      "task-run-42", // task ID
    );
  });
});
