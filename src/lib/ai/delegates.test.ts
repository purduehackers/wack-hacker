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
});
