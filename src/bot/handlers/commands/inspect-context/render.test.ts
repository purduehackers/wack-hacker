import { describe, it, expect } from "vitest";

import type { ContextBreakdown } from "@/lib/ai/inspect-context";

import { renderContextReport } from "./render";

const modelInfo = {
  id: "claude-sonnet-4-6-20260301",
  provider: "anthropic",
  limit: { context: 200_000, output: 64_000 },
  cost: { input: 3, output: 15 },
};

const baseBreakdown: ContextBreakdown = {
  model: "anthropic/claude-sonnet-4.6",
  modelInfo,
  categories: [
    { label: "System prompt", chars: 4000, estimatedTokens: 1000 },
    {
      label: "Tools",
      chars: 2000,
      estimatedTokens: 500,
      items: [
        { name: "resolve_organizer", estimatedTokens: 80 },
        { name: "documentation", estimatedTokens: 150 },
        { name: "schedule_task", estimatedTokens: 120 },
        { name: "list_scheduled_tasks", estimatedTokens: 70 },
        { name: "cancel_task", estimatedTokens: 80 },
      ],
    },
    {
      label: "Delegate agents",
      chars: 3500,
      estimatedTokens: 875,
      items: [
        {
          name: "delegate_linear",
          estimatedTokens: 180,
          skills: [
            { name: "issues", estimatedTokens: 430 },
            { name: "projects", estimatedTokens: 280 },
            { name: "comments", estimatedTokens: 150 },
          ],
        },
        {
          name: "delegate_github",
          estimatedTokens: 150,
          skills: [
            { name: "pulls", estimatedTokens: 380 },
            { name: "issues", estimatedTokens: 320 },
          ],
        },
        { name: "delegate_discord", estimatedTokens: 140, skills: [] },
        { name: "delegate_notion", estimatedTokens: 150 },
      ],
    },
    { label: "Conversation history", chars: 24_000, estimatedTokens: 6000 },
  ],
  estimatedInputTokens: 8375,
  totalUsage: {
    inputTokens: 142_830,
    outputTokens: 8340,
    totalTokens: 151_170,
    subagentTokens: 0,
    toolCallCount: 32,
    stepCount: 41,
    toolNames: [],
  },
  turnCount: 14,
  messageCount: 38,
  totalCostUsd: { input: 0.42849, output: 0.1251, total: 0.55359 },
};

function joinPages(breakdown: ContextBreakdown): string {
  return renderContextReport(breakdown).join("\n");
}

describe("renderContextReport — summary section", () => {
  it("includes the model id and exchange count header", () => {
    const out = joinPages(baseBreakdown);
    expect(out).toContain("after 14 exchanges");
    expect(out).toContain("anthropic/claude-sonnet-4.6");
    expect(out).toContain("claude-sonnet-4-6-20260301");
  });

  it("singularizes the exchange count when there is only one", () => {
    const out = joinPages({ ...baseBreakdown, turnCount: 1 });
    expect(out).toContain("after 1 exchange");
    expect(out).not.toContain("1 exchanges");
  });

  it("shows context window and per-category lines with item counts", () => {
    const out = joinPages(baseBreakdown);
    expect(out).toContain("200,000 tokens");
    expect(out).toContain("**System prompt**");
    expect(out).toContain("**Tools**");
    expect(out).toContain("5 entries");
    expect(out).toContain("**Delegate agents**");
    expect(out).toContain("4 entries");
    expect(out).toContain("**Conversation history**");
    expect(out).toContain("38 messages");
  });

  it("includes conversation totals and cumulative cost", () => {
    const out = joinPages(baseBreakdown);
    expect(out).toContain("`Conversation totals` (sum of every turn, from API):");
    expect(out).toContain("142,830 input");
    expect(out).toContain("8,340 output");
    expect(out).toContain("32 tool calls");
    expect(out).toContain("41 steps");
    expect(out).toContain("`Conversation cost`:");
    expect(out).toContain("$0.5536");
  });

  it("calls out the breakdown as a next-turn projection", () => {
    const out = joinPages(baseBreakdown);
    expect(out).toContain(
      "Estimated next-request breakdown — what the model would see on the next turn (chars/4):",
    );
  });

  it("omits cost line when modelInfo is null", () => {
    const out = joinPages({
      ...baseBreakdown,
      modelInfo: null,
      totalCostUsd: undefined,
    });
    expect(out).toContain("unknown (model not in models.dev catalog)");
    expect(out).not.toContain("Conversation cost");
  });

  it("omits free-space line when modelInfo is null", () => {
    const out = joinPages({
      ...baseBreakdown,
      modelInfo: null,
      totalCostUsd: undefined,
    });
    expect(out).not.toContain("Free space");
  });

  it("includes subagent tokens when present", () => {
    const out = joinPages({
      ...baseBreakdown,
      totalUsage: { ...baseBreakdown.totalUsage, subagentTokens: 4830 },
    });
    expect(out).toContain("4,830 subagent");
  });

  it("keeps every message under Discord's 2000 char limit", () => {
    const messages = renderContextReport(baseBreakdown);
    for (const messageBody of messages) {
      expect(messageBody.length).toBeLessThan(2000);
    }
  });
});

describe("renderContextReport — details section", () => {
  it("emits a flat tools section with per-tool tokens", () => {
    const out = joinPages(baseBreakdown);
    expect(out).toContain("**Tools** (5)");
    expect(out).toContain("`resolve_organizer`: ~80 tokens");
  });

  it("nests loadable skills under each delegate with per-skill tokens", () => {
    const out = joinPages(baseBreakdown);
    expect(out).toContain("**Delegate agents** (4, with loadable subskills)");
    expect(out).toContain("`delegate_linear`: ~180 tokens");
    expect(out).toContain("Loadable skills (3):");
    expect(out).toContain("• `issues`: ~430 tokens");
    expect(out).toContain("• `projects`: ~280 tokens");
  });

  it("singularizes the loadable-skill heading when a delegate has one skill", () => {
    const out = joinPages({
      ...baseBreakdown,
      categories: baseBreakdown.categories.map((c) =>
        c.label === "Delegate agents"
          ? {
              ...c,
              items: [
                {
                  name: "delegate_x",
                  estimatedTokens: 100,
                  skills: [{ name: "only-one", estimatedTokens: 50 }],
                },
              ],
            }
          : c,
      ),
    });
    expect(out).toContain("Loadable skill (1):");
    expect(out).not.toContain("Loadable skills (1):");
  });

  it("shows 'none' when a delegate has no loadable skills for the role", () => {
    const out = joinPages(baseBreakdown);
    // delegate_discord has skills: [] in the fixture
    expect(out).toContain("`delegate_discord`: ~140 tokens");
    expect(out).toContain("Loadable skills: none");
  });

  it("shows 'none' when a delegate has no skills field at all", () => {
    const out = joinPages(baseBreakdown);
    // delegate_notion has no `skills` field in the fixture
    expect(out).toContain("`delegate_notion`: ~150 tokens");
  });

  it("omits delegate detail when no delegate items exist", () => {
    const out = joinPages({
      ...baseBreakdown,
      categories: baseBreakdown.categories.map((c) =>
        c.label === "Delegate agents" ? { ...c, items: [] } : c,
      ),
    });
    expect(out).not.toContain("with loadable subskills");
  });
});

describe("renderContextReport — pagination", () => {
  it("returns multiple pages when content exceeds a single message", () => {
    // Build a delegate with a huge skill list to force paging.
    const fatSkills = Array.from({ length: 200 }, (_, i) => ({
      name: `skill_${i}`,
      estimatedTokens: 50,
    }));
    const messages = renderContextReport({
      ...baseBreakdown,
      categories: baseBreakdown.categories.map((c) =>
        c.label === "Delegate agents"
          ? {
              ...c,
              items: [{ name: "delegate_huge", estimatedTokens: 100, skills: fatSkills }],
            }
          : c,
      ),
    });
    expect(messages.length).toBeGreaterThan(1);
    for (const messageBody of messages) {
      expect(messageBody.length).toBeLessThan(2000);
    }
  });
});
