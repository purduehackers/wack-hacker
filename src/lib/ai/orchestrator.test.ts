import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockProvider,
  messagePacket,
  noopTool as stubTool,
  streamingTextModel,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

import { AgentContext } from "./context.ts";

// --- Boundary mocks ---
// Tools that hit external APIs or initialize SDK clients at import time.
vi.mock("@/lib/ai/tools/docs", () => ({ documentation: stubTool("documentation") }));
vi.mock("@/lib/ai/tools/schedule", () => ({
  scheduleTask: stubTool("scheduleTask"),
  listScheduledTasks: stubTool("listScheduledTasks"),
  cancelTask: stubTool("cancelTask"),
}));
vi.mock("@/lib/ai/tools/schedule/time", () => ({ currentTime: stubTool("currentTime") }));

// delegates.ts transitively imports generated skill manifests (gitignored,
// don't exist on disk) and domain tool modules (initialize SDK clients).
// We mock this single entry-point rather than internal code — it's the
// thinnest boundary that avoids pulling in non-existent generated files.
vi.mock("@/lib/ai/delegates", () => ({
  buildDelegationTools: () => ({
    delegate_linear: stubTool("delegate_linear"),
    delegate_github: stubTool("delegate_github"),
  }),
}));

const { createOrchestrator } = await import("./orchestrator.ts");

describe("createOrchestrator", () => {
  let model: MockLanguageModelV3;

  beforeEach(() => {
    model = streamingTextModel("hi");
    installMockProvider(model);
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  async function drain(ctx: AgentContext) {
    const agent = createOrchestrator(ctx, { totalTokens: 0, toolCallCount: 0 });
    const result = await agent.stream({ prompt: "say hi" });
    const reader = result.toUIMessageStream().getReader();
    while (!(await reader.read()).done);
  }

  function getToolNames(): string[] {
    const call = model.doStreamCalls[0]!;
    return (call.tools ?? [])
      .map((t) => (t as { name?: string }).name)
      .filter((n): n is string => typeof n === "string")
      .sort();
  }

  it("assembles base tools and delegation tools into the agent's tool set", async () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await drain(ctx);

    expect(getToolNames()).toEqual(
      [
        "cancelTask",
        "currentTime",
        "delegate_github",
        "delegate_linear",
        "documentation",
        "listScheduledTasks",
        "scheduleTask",
      ].sort(),
    );
  });

  it("injects execution context into system prompt via buildInstructions", async () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { author: { id: "u1", username: "alice" } }),
    );
    await drain(ctx);

    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === "system");
    const systemContent =
      typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
    expect(systemContent).toContain("<execution_context>");
    expect(systemContent).toContain('username: "alice"');
    expect(systemContent).toContain("Purdue Hackers");
    expect(systemContent).not.toContain("{{DATE}}");
  });
});
