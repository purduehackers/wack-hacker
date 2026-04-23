import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMemoryRedis,
  discordRESTClass,
  installMockProvider,
  linearClientClass,
  notionClientClass,
  octokitClass,
  resendClass,
  streamingTextModel,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

// Shared mock Discord API — task.ts calls `createDiscordAPI()` which constructs
// `new API(new REST(...).setToken(...))` at runtime, so we mock the API class
// and expose outgoing `createMessage` calls through a module-scoped spy.
const hoisted = vi.hoisted(() => ({
  createMessage: vi.fn(async (_ch: string, body: { content: string }) => ({
    id: "msg-1",
    content: body.content,
    channel_id: _ch,
  })),
  editMessage: vi.fn(
    async (_ch: string, _id: string, body: { content: string }) =>
      ({ id: _id, content: body.content, channel_id: _ch }) as unknown,
  ),
}));

// `tasks/registry.ts` memoizes the redis instance from `Redis.fromEnv()` on
// first use (`redis ??= ...`), so we keep the same fixture instance across
// every test and rely on `reset()` in beforeEach to wipe state.
const redis = createMemoryRedis();

vi.mock("@discordjs/core/http-only", () => ({
  API: class MockAPI {
    channels = {
      createMessage: hoisted.createMessage,
      editMessage: hoisted.editMessage,
    };
  },
}));

vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));

// Third-party SDK mocks so `streamTurn` → `createOrchestrator` can load real
// tool modules without initializing live clients.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

vi.mock("workflow", () => ({
  sleep: vi.fn(),
  getWorkflowMetadata: vi.fn(() => ({ workflowRunId: "task-run-42" })),
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redis },
}));

const { taskWorkflow } = await import("./task.ts");

beforeEach(() => {
  vi.clearAllMocks();
  redis.reset();
  hoisted.createMessage.mockImplementation(async (_ch: string, body: { content: string }) => ({
    id: "msg-1",
    content: body.content,
    channel_id: _ch,
  }));
  hoisted.editMessage.mockImplementation(
    async (_ch: string, _id: string, body: { content: string }) => ({
      id: _id,
      content: body.content,
      channel_id: _ch,
    }),
  );
});

describe("taskWorkflow: message action footer", () => {
  it("includes task ID footer for message actions", async () => {
    await taskWorkflow({
      meta: {
        description: "Daily reminder",
        action: { type: "message", channelId: "ch-1", content: "Hello!" },
        schedule: { type: "once", at: new Date(Date.now() + 60_000).toISOString() },
        context: { userId: "u-1", channelId: "ch-1" },
        createdAt: new Date().toISOString(),
      },
    });

    // Registry persisted the task under the workflow run ID.
    const stored = await redis.get<unknown>("task:task-run-42");
    expect(stored).toBeDefined();

    expect(hoisted.createMessage).toHaveBeenCalledOnce();
    const [channelId, body] = hoisted.createMessage.mock.calls[0];
    expect(channelId).toBe("ch-1");
    expect(body.content).toContain("Hello!");
    expect(body.content).toContain("-# Task: task-run-42");
  });
});

describe("taskWorkflow: agent action", () => {
  beforeEach(() => {
    installMockProvider(streamingTextModel("Agent reply."));
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("posts the agent reply with a task-ID footer", async () => {
    await taskWorkflow({
      meta: {
        description: "Daily summary",
        action: { type: "agent", channelId: "ch-1", prompt: "Summarize today" },
        schedule: { type: "once", at: new Date(Date.now() + 60_000).toISOString() },
        context: { userId: "u-1", channelId: "ch-1" },
        createdAt: new Date().toISOString(),
      },
    });

    // The streaming turn posts a placeholder via createMessage and then edits
    // it with the final content including the task footer.
    expect(hoisted.createMessage).toHaveBeenCalled();
    const bodies = [
      ...hoisted.createMessage.mock.calls.map((c) => c[1].content),
      ...hoisted.editMessage.mock.calls.map((c) => c[2].content),
    ];
    expect(bodies.some((c) => c.includes("-# Task: task-run-42"))).toBe(true);
  });
});
