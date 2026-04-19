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
import { TurnUsageTracker } from "./turn-usage.ts";

// --- Boundary mocks: tools that hit external APIs or initialize SDK clients ---

vi.mock("@/lib/ai/tools/docs", () => ({ documentation: stubTool("documentation") }));
vi.mock("@/lib/ai/tools/roster", () => ({ resolve_organizer: stubTool("resolve_organizer") }));
vi.mock("@/lib/ai/tools/schedule", () => ({
  scheduleTask: stubTool("scheduleTask"),
  listScheduledTasks: stubTool("listScheduledTasks"),
  cancelTask: stubTool("cancelTask"),
}));
vi.mock("@/lib/ai/tools/schedule/time", () => ({ currentTime: stubTool("currentTime") }));

// Domain tool modules initialize SDK clients at import time.
vi.mock("@/lib/ai/tools/linear", () => ({
  search_entities: stubTool("search_entities"),
  retrieve_entities: stubTool("retrieve_entities"),
  suggest_property_values: stubTool("suggest_property_values"),
  aggregate_issues: stubTool("aggregate_issues"),
}));
vi.mock("@/lib/ai/tools/github", () => ({
  list_repositories: stubTool("list_repositories"),
  get_repository: stubTool("get_repository"),
  search_code: stubTool("search_code"),
  search_issues: stubTool("search_issues"),
}));
vi.mock("@/lib/ai/tools/discord", () => ({
  get_server_info: stubTool("get_server_info"),
  list_channels: stubTool("list_channels"),
  list_roles: stubTool("list_roles"),
  search_members: stubTool("search_members"),
}));
vi.mock("@/lib/ai/tools/figma", () => ({
  get_file: stubTool("get_file"),
  list_projects: stubTool("list_projects"),
  list_project_files: stubTool("list_project_files"),
  search_files: stubTool("search_files"),
}));
vi.mock("@/lib/ai/tools/notion", () => ({
  search_notion: stubTool("search_notion"),
  retrieve_page: stubTool("retrieve_page"),
  retrieve_database: stubTool("retrieve_database"),
  list_users: stubTool("list_users"),
}));
vi.mock("@/lib/ai/tools/sentry", () => ({
  list_projects: stubTool("list_projects"),
  get_project: stubTool("get_project"),
  search_issues: stubTool("search_issues"),
  get_issue: stubTool("get_issue"),
}));
vi.mock("@/lib/ai/tools/sales", () => ({
  list_companies: stubTool("list_companies"),
  list_contacts: stubTool("list_contacts"),
  list_deals: stubTool("list_deals"),
  get_company: stubTool("get_company"),
  get_contact: stubTool("get_contact"),
  get_deal: stubTool("get_deal"),
  retrieve_crm_schema: stubTool("retrieve_crm_schema"),
}));

const { createOrchestrator } = await import("./orchestrator.ts");

const BASE_TOOLS = [
  "cancelTask",
  "currentTime",
  "documentation",
  "listScheduledTasks",
  "resolve_organizer",
  "scheduleTask",
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
  });
});
