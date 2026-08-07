import { describe, expect, test } from "bun:test";

import { UserRole, roleAtLeast } from "@repo/shared/discord";
import type { SessionAuthContext } from "eve/context";
import type { DynamicResolveContext } from "eve/skills";

import { resolveIntegrationSkills } from "../agent/lib/policy/skill-catalog.ts";
import CMS_SKILL_CATALOG, { CMS_SKILL_DEFINITIONS } from "../agent/subagents/cms/skills/catalog.ts";
import DISCORD_SKILL_CATALOG, {
  DISCORD_SKILL_DEFINITIONS,
} from "../agent/subagents/discord/skills/catalog.ts";
import FIGMA_SKILL_CATALOG, {
  FIGMA_SKILL_DEFINITIONS,
} from "../agent/subagents/figma/skills/catalog.ts";
import FINANCE_SKILL_CATALOG, {
  FINANCE_SKILL_DEFINITIONS,
} from "../agent/subagents/finance/skills/catalog.ts";
import GITHUB_SKILL_CATALOG, {
  GITHUB_SKILL_DEFINITIONS,
} from "../agent/subagents/github/skills/catalog.ts";
import LINEAR_SKILL_CATALOG, {
  LINEAR_SKILL_DEFINITIONS,
} from "../agent/subagents/linear/skills/catalog.ts";
import NOTION_SKILL_CATALOG, {
  NOTION_SKILL_DEFINITIONS,
} from "../agent/subagents/notion/skills/catalog.ts";
import OUTREACH_SKILL_CATALOG, {
  OUTREACH_SKILL_DEFINITIONS,
} from "../agent/subagents/outreach/skills/catalog.ts";
import SENTRY_SKILL_CATALOG, {
  SENTRY_SKILL_DEFINITIONS,
} from "../agent/subagents/sentry/skills/catalog.ts";
import SHOPPING_SKILL_CATALOG, {
  SHOPPING_SKILL_DEFINITIONS,
} from "../agent/subagents/shopping/skills/catalog.ts";
import VERCEL_SKILL_CATALOG, {
  VERCEL_SKILL_DEFINITIONS,
} from "../agent/subagents/vercel/skills/catalog.ts";

const adapters = [
  { name: "cms", catalog: CMS_SKILL_CATALOG, skills: CMS_SKILL_DEFINITIONS },
  { name: "discord", catalog: DISCORD_SKILL_CATALOG, skills: DISCORD_SKILL_DEFINITIONS },
  { name: "figma", catalog: FIGMA_SKILL_CATALOG, skills: FIGMA_SKILL_DEFINITIONS },
  { name: "finance", catalog: FINANCE_SKILL_CATALOG, skills: FINANCE_SKILL_DEFINITIONS },
  { name: "github", catalog: GITHUB_SKILL_CATALOG, skills: GITHUB_SKILL_DEFINITIONS },
  { name: "linear", catalog: LINEAR_SKILL_CATALOG, skills: LINEAR_SKILL_DEFINITIONS },
  { name: "notion", catalog: NOTION_SKILL_CATALOG, skills: NOTION_SKILL_DEFINITIONS },
  { name: "outreach", catalog: OUTREACH_SKILL_CATALOG, skills: OUTREACH_SKILL_DEFINITIONS },
  { name: "sentry", catalog: SENTRY_SKILL_CATALOG, skills: SENTRY_SKILL_DEFINITIONS },
  { name: "shopping", catalog: SHOPPING_SKILL_CATALOG, skills: SHOPPING_SKILL_DEFINITIONS },
  { name: "vercel", catalog: VERCEL_SKILL_CATALOG, skills: VERCEL_SKILL_DEFINITIONS },
] as const;

function auth(role: UserRole): SessionAuthContext {
  return {
    authenticator: "native-skill-test",
    principalType: "user",
    principalId: "10000000000000000",
    attributes: { role },
  };
}

async function resolveCatalog(
  catalog: (typeof adapters)[number]["catalog"],
  current: SessionAuthContext | null,
) {
  const resolver = catalog.events["turn.started"];
  if (resolver === undefined) throw new Error("native skill catalog lacks turn.started");
  const context: DynamicResolveContext = {
    session: { id: "native-skill-test-session", auth: { current, initiator: current } },
    channel: {},
    messages: [],
  };
  return await resolver({}, context);
}

const roles = [UserRole.Public, UserRole.Organizer, UserRole.Admin] as const;

describe("integration skill policy", () => {
  test("fails closed without a current principal", async () => {
    for (const adapter of adapters) {
      // oxlint-disable-next-line unicorn/no-null -- Eve models absent current auth as null
      expect(resolveIntegrationSkills(null, adapter.skills), adapter.name).toEqual({});
      // oxlint-disable-next-line unicorn/no-null -- exercise the authored Eve resolver's nullable auth path.
      expect(await resolveCatalog(adapter.catalog, null), adapter.name).toEqual({});
    }
  });

  test("returns empty catalogs after an authority downgrade", async () => {
    for (const adapter of adapters) {
      const organizer = await resolveCatalog(adapter.catalog, auth(UserRole.Organizer));
      expect(Object.keys(organizer ?? {}).length, `${adapter.name}/organizer`).toBeGreaterThan(0);
      expect(await resolveCatalog(adapter.catalog, auth(UserRole.Public)), adapter.name).toEqual(
        {},
      );
      // oxlint-disable-next-line unicorn/no-null -- exercise the next anonymous turn on the same resolver.
      expect(await resolveCatalog(adapter.catalog, null), adapter.name).toEqual({});
    }
  });

  test("Eve-native discovery and loading preserve every declared role and instruction", async () => {
    for (const adapter of adapters) {
      for (const role of roles) {
        const expected = adapter.skills.filter((skill) => roleAtLeast(role, skill.minRole));
        const available = await resolveCatalog(adapter.catalog, auth(role));
        expect(Object.keys(available ?? {}), `${adapter.name}/${role}`).toEqual(
          expected.map((skill) => skill.name),
        );
        if (available === null || available === undefined) continue;
        for (const skill of expected) {
          const markdown = available[skill.name]?.markdown;
          expect(markdown, `${adapter.name}/${skill.name}/criteria`).toContain(skill.criteria);
          expect(markdown, `${adapter.name}/${skill.name}/instructions`).toEndWith(
            skill.instructions,
          );
          for (const tool of skill.tools) {
            expect(markdown, `${adapter.name}/${skill.name}/${tool}`).toContain(`\`${tool}\``);
          }
          expect(
            available[skill.name]?.description,
            `${adapter.name}/${skill.name}/description`,
          ).toBe(skill.description);
          expect(available[skill.name]?.metadata, `${adapter.name}/${skill.name}/metadata`).toEqual(
            { criteria: skill.criteria, minRole: skill.minRole },
          );
        }
      }
    }
  });
});
