import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  discordRESTClass,
  installMockProvider,
  linearClientClass,
  messagePacket,
  notionClientClass,
  octokitClass,
  resendClass,
  streamingTextModel,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

import { AgentContext } from "./context.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

// Third-party SDK mocks — neutralize clients that our tool modules
// instantiate at import time so the real tool definitions load safely.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));
vi.mock("workflow/api", () => ({
  start: vi.fn().mockResolvedValue({ runId: "run-test" }),
  getRun: vi.fn(() => ({ cancel: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: class MockSandbox {},
}));

const { createOrchestrator } = await import("./orchestrator.ts");

// Post-policy public surface: read tools with minRole "public". Write and
// destructive tools (schedule_task, cancel_task) require organizer+.
const PUBLIC_TOOLS = ["documentation", "list_scheduled_tasks", "resolve_organizer", "web_search"];
const ORGANIZER_BASE_TOOLS = [...PUBLIC_TOOLS, "cancel_task", "schedule_task"];

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
    const agent = createOrchestrator(ctx, new TurnUsageTracker());
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

  it("gives public users only public read tools (writes and delegates require organizer+)", async () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await drain(ctx);

    expect(getToolNames()).toEqual([...PUBLIC_TOOLS].sort());
  });

  it("includes delegation tools for users with the organizer role", async () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1012751663322382438"] }),
    );
    await drain(ctx);

    const tools = getToolNames();
    expect(tools).toEqual(
      expect.arrayContaining([
        ...ORGANIZER_BASE_TOOLS,
        "delegate_discord",
        "delegate_figma",
        "delegate_github",
        "delegate_linear",
        "delegate_notion",
        "delegate_sales",
        "delegate_sentry",
      ]),
    );
  });

  it("exposes the audit log tool to admins but not organizers", async () => {
    const organizerCtx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1012751663322382438"] }),
    );
    await drain(organizerCtx);
    expect(getToolNames()).not.toContain("list_audit_log");

    model = streamingTextModel("hi");
    installMockProvider(model);
    const adminCtx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1344066433172373656"] }),
    );
    await drain(adminCtx);
    expect(getToolNames()).toContain("list_audit_log");
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
