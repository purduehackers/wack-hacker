import { describe, expect, test } from "bun:test";

import { UserRole, roleAtLeast } from "@repo/shared/discord";
import type { SessionAuthContext } from "eve/context";

import { CMS_SKILLS } from "../agent/subagents/cms/lib/skills.generated.ts";
import { availableCmsSkills, loadCmsSkill } from "../agent/subagents/cms/lib/skills.ts";
import { DISCORD_SKILLS } from "../agent/subagents/discord/lib/skills.generated.ts";
import { availableDiscordSkills, loadDiscordSkill } from "../agent/subagents/discord/lib/skills.ts";
import { FIGMA_SKILLS } from "../agent/subagents/figma/lib/skills.generated.ts";
import { availableFigmaSkills, loadFigmaSkill } from "../agent/subagents/figma/lib/skills.ts";
import { FINANCE_SKILLS } from "../agent/subagents/finance/lib/skills.generated.ts";
import { availableFinanceSkills, loadFinanceSkill } from "../agent/subagents/finance/lib/skills.ts";
import { GITHUB_SKILLS } from "../agent/subagents/github/lib/skills.generated.ts";
import { availableGithubSkills, loadGithubSkill } from "../agent/subagents/github/lib/skills.ts";
import { LINEAR_SKILLS } from "../agent/subagents/linear/lib/skills.generated.ts";
import { availableLinearSkills, loadLinearSkill } from "../agent/subagents/linear/lib/skills.ts";
import { NOTION_SKILLS } from "../agent/subagents/notion/lib/skills.generated.ts";
import { availableNotionSkills, loadNotionSkill } from "../agent/subagents/notion/lib/skills.ts";
import { OUTREACH_SKILLS } from "../agent/subagents/outreach/lib/skills.generated.ts";
import {
  availableOutreachSkills,
  loadOutreachSkill,
} from "../agent/subagents/outreach/lib/skills.ts";
import { SENTRY_SKILLS } from "../agent/subagents/sentry/lib/skills.generated.ts";
import { availableSentrySkills, loadSentrySkill } from "../agent/subagents/sentry/lib/skills.ts";
import { SHOPPING_SKILLS } from "../agent/subagents/shopping/lib/skills.generated.ts";
import {
  availableShoppingSkills,
  loadShoppingSkill,
} from "../agent/subagents/shopping/lib/skills.ts";
import { VERCEL_SKILLS } from "../agent/subagents/vercel/lib/skills.generated.ts";
import { availableVercelSkills, loadVercelSkill } from "../agent/subagents/vercel/lib/skills.ts";

const adapters = [
  { name: "cms", skills: CMS_SKILLS, available: availableCmsSkills, load: loadCmsSkill },
  {
    name: "discord",
    skills: DISCORD_SKILLS,
    available: availableDiscordSkills,
    load: loadDiscordSkill,
  },
  { name: "figma", skills: FIGMA_SKILLS, available: availableFigmaSkills, load: loadFigmaSkill },
  {
    name: "finance",
    skills: FINANCE_SKILLS,
    available: availableFinanceSkills,
    load: loadFinanceSkill,
  },
  {
    name: "github",
    skills: GITHUB_SKILLS,
    available: availableGithubSkills,
    load: loadGithubSkill,
  },
  {
    name: "linear",
    skills: LINEAR_SKILLS,
    available: availableLinearSkills,
    load: loadLinearSkill,
  },
  {
    name: "notion",
    skills: NOTION_SKILLS,
    available: availableNotionSkills,
    load: loadNotionSkill,
  },
  {
    name: "outreach",
    skills: OUTREACH_SKILLS,
    available: availableOutreachSkills,
    load: loadOutreachSkill,
  },
  {
    name: "sentry",
    skills: SENTRY_SKILLS,
    available: availableSentrySkills,
    load: loadSentrySkill,
  },
  {
    name: "shopping",
    skills: SHOPPING_SKILLS,
    available: availableShoppingSkills,
    load: loadShoppingSkill,
  },
  {
    name: "vercel",
    skills: VERCEL_SKILLS,
    available: availableVercelSkills,
    load: loadVercelSkill,
  },
] as const;

function auth(role: UserRole): SessionAuthContext {
  return {
    authenticator: "phase-zero-test",
    principalType: "user",
    principalId: "10000000000000000",
    attributes: { role },
  };
}

const roles = [UserRole.Public, UserRole.Organizer, UserRole.Admin] as const;

describe("integration skill policy", () => {
  test("fails closed without a current principal", () => {
    for (const adapter of adapters) {
      // oxlint-disable-next-line unicorn/no-null -- Eve models absent current auth as null
      expect(adapter.available(null), adapter.name).toEqual([]);
      const first = adapter.skills[0];
      if (first === undefined) throw new Error(`${adapter.name} has no skills`);
      // oxlint-disable-next-line unicorn/no-null -- exercise Eve's actual nullable auth contract
      const loaded = adapter.load(first.name, null);
      expect(loaded.status, adapter.name).toBe("error");
      if (loaded.status === "error")
        expect(loaded.error._tag, adapter.name).toBe("Unauthenticated");
    }
  });

  test("discovery and loading agree with every declared minimum role", () => {
    for (const adapter of adapters) {
      for (const role of roles) {
        const current = auth(role);
        const expected = adapter.skills.filter((skill) => roleAtLeast(role, skill.minRole));
        expect(
          adapter.available(current).map((skill) => skill.name),
          `${adapter.name}/${role}`,
        ).toEqual(expected.map((skill) => skill.name));

        for (const skill of adapter.skills) {
          const loaded = adapter.load(skill.name, current);
          if (roleAtLeast(role, skill.minRole)) {
            expect(loaded.status, `${adapter.name}/${role}/${skill.name}`).toBe("ok");
            if (loaded.status === "ok") expect(loaded.value).toEqual(skill);
          } else {
            expect(loaded.status, `${adapter.name}/${role}/${skill.name}`).toBe("error");
            if (loaded.status === "error") expect(loaded.error._tag).toBe("Forbidden");
          }
        }

        const missing = adapter.load("unknown-skill", current);
        expect(missing.status, `${adapter.name}/${role}`).toBe("error");
        if (missing.status === "error") expect(missing.error._tag).toBe("NotFound");
      }
    }
  });
});
