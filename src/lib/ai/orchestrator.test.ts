import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { UserRole } from "./constants.ts";
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

const { createOrchestrator, getOrchestratorTools, SYSTEM_PROMPT } =
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

  it("marks the last tool and last message with an anthropic cache breakpoint", async () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await drain(ctx);

    const call = model.doStreamCalls[0]!;
    const tools = (call.tools ?? []) as { providerOptions?: Record<string, unknown> }[];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.at(-1)!.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    // Only the last tool carries a breakpoint — Anthropic allows at most 4
    // per request and the trailing message takes another.
    for (const t of tools.slice(0, -1)) {
      expect(t.providerOptions?.anthropic).toBeUndefined();
    }

    const lastMessage = call.prompt.at(-1)! as { providerOptions?: Record<string, unknown> };
    expect(lastMessage.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("only documents registered tools in the system prompt <tools> section", () => {
    // Admin context: every delegate tool named in the prompt is role-gated
    // (delegate_code is admin-only), so a public surface would false-fail.
    const tools = getOrchestratorTools(contextForRole(UserRole.Admin), new TurnUsageTracker());

    const section = SYSTEM_PROMPT.match(/<tools>([\s\S]*?)<\/tools>/)?.[1] ?? "";
    const documented = [...section.matchAll(/^- \*\*([^*]+)\*\*/gm)].flatMap((m) =>
      m[1]!.split("/").map((name) => name.trim()),
    );

    expect(documented).toContain("web_search");
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(documented));
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
