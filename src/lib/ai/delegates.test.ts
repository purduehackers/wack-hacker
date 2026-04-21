import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import { AgentContext } from "@/lib/ai/context";
import { TurnUsageTracker } from "@/lib/ai/turn-usage";
import { DISCORD_IDS } from "@/lib/protocol/constants";
import { messagePacket } from "@/lib/test/fixtures";

function contextFor(role: UserRole): AgentContext {
  const memberRoles =
    role === UserRole.Admin
      ? [DISCORD_IDS.roles.ADMIN]
      : role === UserRole.Organizer
        ? [DISCORD_IDS.roles.ORGANIZER]
        : [];
  return AgentContext.fromPacket(messagePacket("hello", { memberRoles }));
}

// Mock the generated manifest so tests aren't coupled to the real skill set.
vi.mock("@/lib/ai/skills/generated/manifest", () => ({
  SKILL_MANIFEST: {
    linear: {
      name: "linear",
      description: "Linear delegate",
      criteria: "when asked about Linear",
      toolNames: [],
      minRole: UserRole.Organizer,
      mode: "delegate",
      instructions: "Linear instructions.",
    },
    github: {
      name: "github",
      description: "GitHub delegate",
      criteria: "when asked about GitHub",
      toolNames: [],
      minRole: UserRole.Admin,
      mode: "delegate",
      instructions: "GitHub instructions.",
    },
    discord: {
      name: "discord",
      description: "Discord inline skill",
      criteria: "when asked about Discord",
      toolNames: [],
      minRole: UserRole.Public,
      mode: "inline",
      instructions: "Discord instructions.",
    },
    figma: {
      name: "figma",
      description: "Figma delegate",
      criteria: "when asked about Figma",
      toolNames: [],
      minRole: UserRole.Organizer,
      mode: "delegate",
      instructions: "Figma instructions.",
    },
    sentry: {
      name: "sentry",
      description: "Sentry delegate",
      criteria: "when asked about Sentry",
      toolNames: [],
      minRole: UserRole.Organizer,
      mode: "delegate",
      instructions: "Sentry instructions.",
    },
    finance: {
      name: "finance",
      description: "Finance delegate",
      criteria: "when asked about finances",
      toolNames: [],
      minRole: UserRole.Organizer,
      mode: "delegate",
      instructions: "Finance instructions.",
    },
    sales: {
      name: "sales",
      description: "Sales delegate",
      criteria: "when asked about the CRM",
      toolNames: [],
      minRole: UserRole.Organizer,
      mode: "delegate",
      instructions: "Sales instructions.",
    },
    // notion is intentionally omitted — buildDelegationTools should tolerate missing domains.
  },
}));

// Stub the per-domain sub-skill manifests with empty records.
vi.mock("@/lib/ai/skills/generated/domains/linear", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/github", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/discord", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/figma", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/notion", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/sales", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/sentry", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/finance", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/shopping", () => ({ SKILL_MANIFEST: {} }));

// Stub the heavy tool index modules so env-backed SDK clients don't initialize.
vi.mock("@/lib/ai/tools/linear", () => ({}));
vi.mock("@/lib/ai/tools/github", () => ({}));
vi.mock("@/lib/ai/tools/discord", () => ({}));
vi.mock("@/lib/ai/tools/figma", () => ({}));
vi.mock("@/lib/ai/tools/notion", () => ({}));
vi.mock("@/lib/ai/tools/sales", () => ({}));
vi.mock("@/lib/ai/tools/sentry", () => ({}));
vi.mock("@/lib/ai/tools/finance", () => ({}));
vi.mock("@/lib/ai/tools/shopping", () => ({}));

// Stub createDelegationTool so we can see what spec each domain was passed.
vi.mock("@/lib/ai/subagent", () => ({
  createDelegationTool: vi.fn((spec: unknown, context: unknown, _metrics: unknown) => ({
    __marker: "delegation-tool",
    spec,
    context,
  })),
}));

const { buildDelegationTools } = await import("./delegates.ts");
const { createDelegationTool } = await import("./subagent.ts");
const createDelegationToolMock = vi.mocked(createDelegationTool);

describe("buildDelegationTools", () => {
  it("returns an empty set for public users (all delegate skills are gated above public)", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(contextFor(UserRole.Public), new TurnUsageTracker());
    expect(tools).toEqual({});
    expect(createDelegationToolMock).not.toHaveBeenCalled();
  });

  it("exposes only organizer-accessible delegate skills to organizers", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(contextFor(UserRole.Organizer), new TurnUsageTracker());
    expect(Object.keys(tools).sort()).toEqual([
      "delegate_figma",
      "delegate_finance",
      "delegate_linear",
      "delegate_sales",
      "delegate_sentry",
    ]);
  });

  it("exposes every delegate skill to admins", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(contextFor(UserRole.Admin), new TurnUsageTracker());
    expect(Object.keys(tools).sort()).toEqual([
      "delegate_figma",
      "delegate_finance",
      "delegate_github",
      "delegate_linear",
      "delegate_sales",
      "delegate_sentry",
    ]);
  });

  it("skips inline-mode skills even when the role qualifies", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(contextFor(UserRole.Admin), new TurnUsageTracker());
    expect(tools).not.toHaveProperty("delegate_discord");
  });

  it("passes the skill description and instructions through to createDelegationTool", () => {
    createDelegationToolMock.mockClear();
    buildDelegationTools(contextFor(UserRole.Admin), new TurnUsageTracker());

    const linearCall = createDelegationToolMock.mock.calls.find(
      ([spec]) => (spec as { description: string }).description === "Linear delegate",
    );
    expect(linearCall).toBeDefined();
    const [spec, context] = linearCall!;
    expect((spec as { systemPrompt: string }).systemPrompt).toBe("Linear instructions.");
    expect((spec as { baseToolNames: readonly string[] }).baseToolNames).toContain(
      "search_entities",
    );
    expect((context as AgentContext).role).toBe(UserRole.Admin);
  });
});
