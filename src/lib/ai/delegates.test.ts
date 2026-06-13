import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import { TurnUsageTracker } from "@/lib/ai/turn-usage";
import {
  contextForRole,
  discordRESTClass,
  linearClientClass,
  notionClientClass,
  octokitClass,
  resendClass,
} from "@/lib/test/fixtures";

// Third-party SDK mocks — neutralize clients so real tool modules import cleanly.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { buildDelegationTools } = await import("./delegates.ts");
const { DOMAINS } = await import("./skills/generated/domains.ts");
const { SKILL_MANIFEST } = await import("./skills/generated/manifest.ts");

const ROLE_LEVEL: Record<UserRole, number> = {
  public: 0,
  organizer: 1,
  admin: 2,
};

function expectedDelegateNames(role: UserRole): string[] {
  return Object.values(SKILL_MANIFEST)
    .filter((s) => s.mode === "delegate" && ROLE_LEVEL[s.minRole] <= ROLE_LEVEL[role])
    .map((s) => `delegate_${s.name}`)
    .sort();
}

describe("buildDelegationTools", () => {
  it("returns an empty set for public users (all delegate skills are gated above public)", () => {
    const tools = buildDelegationTools(contextForRole(UserRole.Public), new TurnUsageTracker());
    expect(tools).toEqual({});
  });

  it("exposes every organizer-accessible delegate skill to organizers", () => {
    const tools = buildDelegationTools(contextForRole(UserRole.Organizer), new TurnUsageTracker());
    expect(Object.keys(tools).sort()).toEqual(expectedDelegateNames(UserRole.Organizer));
  });

  it("exposes every admin-accessible delegate skill to admins", () => {
    const tools = buildDelegationTools(contextForRole(UserRole.Admin), new TurnUsageTracker());
    expect(Object.keys(tools).sort()).toEqual(expectedDelegateNames(UserRole.Admin));
  });

  it("produces a tool for every delegate-mode skill whose minRole is met", () => {
    const tools = buildDelegationTools(contextForRole(UserRole.Admin), new TurnUsageTracker());
    for (const skill of Object.values(SKILL_MANIFEST)) {
      if (skill.mode === "delegate" && ROLE_LEVEL[skill.minRole] <= ROLE_LEVEL[UserRole.Admin]) {
        expect(tools).toHaveProperty(`delegate_${skill.name}`);
      }
    }
  });

  it("appends routing criteria to every delegation tool description", () => {
    const tools = buildDelegationTools(contextForRole(UserRole.Admin), new TurnUsageTracker());
    for (const [name, tool] of Object.entries(tools)) {
      const description = (tool as { description?: string }).description ?? "";
      expect(description, `${name} description should carry criteria`).toContain(". Use when: ");
    }
  });
});

// Drift guards over the generated domain registry: every tool name a SKILL.md
// declares (baseTools frontmatter, sub-skill `tools` lists) must resolve to a
// real export in the domain's tool barrel.
describe("generated DOMAINS registry", () => {
  it("resolves every baseTool to a real tool export", () => {
    for (const [domain, config] of Object.entries(DOMAINS)) {
      const missing = config.baseToolNames.filter((name) => !(name in config.tools));
      expect(missing, `${domain}: baseTools missing from tool barrel`).toEqual([]);
    }
  });

  it("resolves every sub-skill tool to a real tool export", () => {
    for (const [domain, config] of Object.entries(DOMAINS)) {
      for (const [subName, bundle] of Object.entries(config.subSkills)) {
        const missing = bundle.toolNames.filter((name) => !(name in config.tools));
        expect(missing, `${domain}/${subName}: tools missing from barrel`).toEqual([]);
      }
    }
  });

  it("registers every delegate-mode skill from the top-level manifest", () => {
    const delegateSkills = Object.values(SKILL_MANIFEST)
      .filter((s) => s.mode === "delegate")
      .map((s) => s.name)
      .sort();
    expect(Object.keys(DOMAINS).sort()).toEqual(delegateSkills);
  });

  // DOMAINS keys are generated strings now, so a stale DOMAIN_SPEC_OVERRIDES
  // key no longer fails typecheck — it would silently stop applying and
  // delegate_code would fall back to the default `{ task }` schema, model,
  // and step cap. The custom input schema is the observable fingerprint.
  it("applies the code domain's spec overrides (custom { repo, task } schema)", () => {
    const tools = buildDelegationTools(contextForRole(UserRole.Admin), new TurnUsageTracker());
    const schema = (tools.delegate_code as { inputSchema?: unknown }).inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ repo: "purduehackers/site", task: "fix the bug" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ task: "fix the bug" }).success).toBe(false);
  });
});
