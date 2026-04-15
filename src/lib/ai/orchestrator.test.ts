import type { UIMessage } from "ai";
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

// Mock heavy tool modules so env-backed clients don't boot.
vi.mock("@/lib/ai/tools/docs", () => ({ documentation: stubTool("documentation") }));
vi.mock("@/lib/ai/tools/schedule", () => ({
  scheduleTask: stubTool("scheduleTask"),
  listScheduledTasks: stubTool("listScheduledTasks"),
  cancelTask: stubTool("cancelTask"),
}));
vi.mock("@/lib/ai/tools/schedule/time", () => ({ currentTime: stubTool("currentTime") }));

// Mock delegates so we don't transitively pull the domain tool imports.
const buildDelegationToolsMock = vi.fn(() => ({
  delegate_linear: stubTool("delegate_linear"),
}));
vi.mock("@/lib/ai/delegates", () => ({
  buildDelegationTools: buildDelegationToolsMock,
}));

const { createOrchestrator } = await import("./orchestrator.ts");

function contextFromFixture() {
  return AgentContext.fromPacket(
    messagePacket("hello", { author: { id: "u1", username: "alice" } }),
  );
}

describe("createOrchestrator", () => {
  let model: MockLanguageModelV3;

  beforeEach(() => {
    buildDelegationToolsMock.mockClear();
    model = streamingTextModel("hi");
    installMockProvider(model);
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  async function drain(ctx: AgentContext) {
    const agent = createOrchestrator(ctx, { totalTokens: 0, toolCallCount: 0 });
    const result = await agent.stream({ prompt: "say hi" });
    const messages: UIMessage[] = [];
    // toUIMessageStream works but we just need to consume the stream so the
    // model call is recorded on the mock.
    const reader = result.toUIMessageStream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      void value;
      messages.push(value as unknown as UIMessage);
    }
    return messages;
  }

  it("passes role-specific delegation tools to the agent's tool set", async () => {
    const ctx = contextFromFixture();
    await drain(ctx);

    expect(buildDelegationToolsMock).toHaveBeenCalled();
    expect((buildDelegationToolsMock.mock.calls as unknown[][])[0]![0]).toBe(ctx.role);

    const call = model.doStreamCalls[0]!;
    const toolNames = (call.tools ?? [])
      .map((t) => (t as { name?: string }).name)
      .filter((n): n is string => typeof n === "string");
    expect(toolNames.sort()).toEqual(
      [
        "cancelTask",
        "currentTime",
        "delegate_linear",
        "documentation",
        "listScheduledTasks",
        "scheduleTask",
      ].sort(),
    );
  });

  it("runs instructions through context.buildInstructions so execution context is injected", async () => {
    const ctx = contextFromFixture();
    await drain(ctx);

    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === "system");
    const systemContent =
      typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
    expect(systemContent).toContain("<execution_context>");
    expect(systemContent).toContain('username: "alice"');
    expect(systemContent).toContain("Purdue Hackers");
    // {{DATE}} placeholder must have been replaced by buildInstructions.
    expect(systemContent).not.toContain("{{DATE}}");
  });
});
