import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import {
  contextForRole,
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

const { buildSystemPrompt, createOrchestrator, getOrchestratorTools } =
  await import("./orchestrator.ts");

const BASE_TOOLS = [
  "cancel_task",
  "documentation",
  "list_scheduled_tasks",
  "resolve_organizer",
  "schedule_task",
  "web_search",
];

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

  it("gives public users only base tools (all delegate skills require organizer+)", async () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await drain(ctx);

    expect(getToolNames()).toEqual(BASE_TOOLS.sort());
  });

  it("includes delegation tools for users with the organizer role", async () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1012751663322382438"] }),
    );
    await drain(ctx);

    const tools = getToolNames();
    expect(tools).toEqual(
      expect.arrayContaining([
        ...BASE_TOOLS,
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
    expect(systemContent).not.toContain("{{DELEGATES}}");
  });
});

describe("buildSystemPrompt", () => {
  function delegatesInPrompt(prompt: string): string[] {
    return [...new Set(prompt.match(/delegate_[a-z0-9_]+/g) ?? [])].sort();
  }

  function delegatesInToolSet(role: UserRole): string[] {
    const tools = getOrchestratorTools(contextForRole(role), new TurnUsageTracker());
    return Object.keys(tools)
      .filter((name) => name.startsWith("delegate_"))
      .sort();
  }

  // Drift guard: the prompt's delegate docs are generated from the same
  // registry as the delegation tools, so every delegate name the model reads
  // about must exist in its ToolSet — and vice versa.
  it("mentions exactly the organizer's delegate tools", () => {
    const prompt = buildSystemPrompt(contextForRole(UserRole.Organizer));
    expect(delegatesInPrompt(prompt)).toEqual(delegatesInToolSet(UserRole.Organizer));
  });

  it("mentions exactly the admin's delegate tools (including delegate_code)", () => {
    const prompt = buildSystemPrompt(contextForRole(UserRole.Admin));
    const mentioned = delegatesInPrompt(prompt);
    expect(mentioned).toContain("delegate_code");
    expect(mentioned).toEqual(delegatesInToolSet(UserRole.Admin));
  });

  it("documents each delegate with its routing criteria", () => {
    const prompt = buildSystemPrompt(contextForRole(UserRole.Organizer));
    for (const name of delegatesInToolSet(UserRole.Organizer)) {
      expect(prompt).toMatch(new RegExp(`\\*\\*${name}\\*\\* — use when: .+`));
    }
  });

  // Base tools stay hand-written in SYSTEM_PROMPT, so cross-check every
  // **bold** tool mention (base and delegate, including "a / b / c" bullets)
  // against the actual ToolSet — stale prose about a renamed tool fails here.
  it("documents only tools that exist in the role's ToolSet (base + delegates)", () => {
    for (const role of [UserRole.Organizer, UserRole.Admin]) {
      const prompt = buildSystemPrompt(contextForRole(role));
      const tools = getOrchestratorTools(contextForRole(role), new TurnUsageTracker());
      const mentioned = [...prompt.matchAll(/\*\*([a-z0-9_ /]+)\*\*/g)]
        .flatMap((m) => m[1].split(" / "))
        .map((name) => name.trim());
      expect(mentioned.length).toBeGreaterThan(0);
      for (const name of mentioned) {
        expect(tools, `prompt documents nonexistent tool ${name} for ${role}`).toHaveProperty(name);
      }
    }
  });

  it("renders no delegation docs for public users", () => {
    const prompt = buildSystemPrompt(contextForRole(UserRole.Public));
    expect(prompt).not.toContain("delegate_");
    expect(prompt).not.toContain("{{DELEGATES}}");
  });

  it("leaves no unsubstituted placeholder for any role", () => {
    for (const role of [UserRole.Public, UserRole.Organizer, UserRole.Admin]) {
      expect(buildSystemPrompt(contextForRole(role))).not.toContain("{{DELEGATES}}");
    }
  });
});
