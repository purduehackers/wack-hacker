import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/lib/ai/constants";

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
    // notion is intentionally omitted — buildDelegationTools should tolerate missing domains.
  },
}));

// Stub the per-domain sub-skill manifests with empty records.
vi.mock("@/lib/ai/skills/generated/domains/linear", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/github", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/discord", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/figma", () => ({ SKILL_MANIFEST: {} }));
vi.mock("@/lib/ai/skills/generated/domains/notion", () => ({ SKILL_MANIFEST: {} }));

// Stub the heavy tool index modules so env-backed SDK clients don't initialize.
vi.mock("@/lib/ai/tools/linear", () => ({}));
vi.mock("@/lib/ai/tools/github", () => ({}));
vi.mock("@/lib/ai/tools/discord", () => ({}));
vi.mock("@/lib/ai/tools/figma", () => ({}));
vi.mock("@/lib/ai/tools/notion", () => ({}));

// Stub createDelegationTool so we can see what spec each domain was passed.
vi.mock("@/lib/ai/subagent", () => ({
  createDelegationTool: vi.fn((spec: unknown, role: unknown, _metrics: unknown) => ({
    __marker: "delegation-tool",
    spec,
    role,
  })),
}));

const { buildDelegationTools } = await import("./delegates.ts");
const { createDelegationTool } = await import("./subagent.ts");
const createDelegationToolMock = vi.mocked(createDelegationTool);

describe("buildDelegationTools", () => {
  it("returns an empty set for public users (all delegate skills are gated above public)", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(UserRole.Public, { totalTokens: 0, toolCallCount: 0 });
    expect(tools).toEqual({});
    expect(createDelegationToolMock).not.toHaveBeenCalled();
  });

  it("exposes only organizer-accessible delegate skills to organizers", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(UserRole.Organizer, { totalTokens: 0, toolCallCount: 0 });
    expect(Object.keys(tools).sort()).toEqual(["delegate_figma", "delegate_linear"]);
  });

  it("exposes every delegate skill to admins", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(UserRole.Admin, { totalTokens: 0, toolCallCount: 0 });
    expect(Object.keys(tools).sort()).toEqual([
      "delegate_figma",
      "delegate_github",
      "delegate_linear",
    ]);
  });

  it("skips inline-mode skills even when the role qualifies", () => {
    createDelegationToolMock.mockClear();
    const tools = buildDelegationTools(UserRole.Admin, { totalTokens: 0, toolCallCount: 0 });
    expect(tools).not.toHaveProperty("delegate_discord");
  });

  it("passes the skill description and instructions through to createDelegationTool", () => {
    createDelegationToolMock.mockClear();
    buildDelegationTools(UserRole.Admin, { totalTokens: 0, toolCallCount: 0 });

    const linearCall = createDelegationToolMock.mock.calls.find(
      ([spec]) => (spec as { description: string }).description === "Linear delegate",
    );
    expect(linearCall).toBeDefined();
    const [spec, role] = linearCall!;
    expect((spec as { systemPrompt: string }).systemPrompt).toBe("Linear instructions.");
    expect((spec as { baseToolNames: readonly string[] }).baseToolNames).toContain(
      "search_entities",
    );
    expect(role).toBe(UserRole.Admin);
  });
});
