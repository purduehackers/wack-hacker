import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

// A few domain clients construct their SDK at import time and throw without
// credentials (Octokit needs an appId, LinearClient an apiKey, etc.). This
// suite only reads tool metadata (names/domain), never a live client, so stub
// the eager-throwing client modules — keeping their helper exports — so the
// barrels import clean. (The eager construction is itself a fragility worth
// making lazy; tracked separately.)
vi.mock("./github/client.ts", () => ({ octokit: {} }));
vi.mock("./linear/client.ts", () => ({
  linear: {},
  issueFilter: () => ({}),
  applyIssueRelations: async () => {},
}));
vi.mock("./notion/client.ts", () => ({
  notion: {},
  richTextToPlain: () => "",
}));

import { DOMAINS } from "../skills/generated/domains.ts";
import { getToolMeta } from "./_shared/define-tool.ts";

/**
 * Coverage manifest for every delegate domain. Every exported tool must be
 * accounted for — reachable by the model (always-on via the domain's
 * `baseToolNames`, or activated by a sub-skill's `tools:` list) or parked
 * behind a disabled (`_`-prefixed) sub-skill. An orphan is neither: dead weight
 * the model can never call. Wire it into a SKILL.md, park it, or delete it.
 * (knip can't catch these — `src/lib/ai/tools/**` is in its ignore list.)
 *
 * Driven by the generated `DOMAINS` registry, so a new domain is covered the
 * moment `compile-skills.ts` emits it — no edits needed here.
 */
function exportedToolNames(tools: Record<string, unknown>): string[] {
  return Object.entries(tools)
    .filter(([, t]) => t && typeof t === "object" && "inputSchema" in (t as object))
    .map(([name]) => name);
}

function referencedToolNames(
  baseToolNames: readonly string[],
  parkedToolNames: readonly string[],
  subSkills: Record<string, { toolNames: readonly string[] }>,
): Set<string> {
  // baseToolNames + every active sub-skill's tools = reachable. parkedToolNames
  // = tools held only by a disabled (`_`) sub-skill: not reachable, but parked
  // on purpose, so not orphans either.
  const referenced = new Set<string>([...baseToolNames, ...parkedToolNames]);
  for (const skill of Object.values(subSkills)) {
    for (const name of skill.toolNames) referenced.add(name);
  }
  return referenced;
}

/**
 * Tools listed only by a DISABLED sub-skill. Disabling a skill is just renaming
 * its dir with a leading `_` (which `compile-skills` skips). Those tools are
 * unreachable but parked on purpose — read their `tools:` straight from the
 * disabled SKILL.md so the orphan check honors the disable with no build-time
 * plumbing.
 */
function parkedToolNames(domain: string): string[] {
  const dir = join(process.cwd(), "src/lib/ai/skills", domain, "skills");
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("_")) continue;
    const frontmatter = readFileSync(join(dir, entry.name, "SKILL.md"), "utf8").match(
      /^---\n([\s\S]*?)\n---/,
    );
    if (!frontmatter) continue;
    names.push(...((parseYaml(frontmatter[1]) as { tools?: string[] }).tools ?? []));
  }
  return names;
}

const DOMAIN_CASES = Object.entries(DOMAINS).map(([domain, d]) => ({
  domain,
  tools: d.tools as unknown as Record<string, unknown>,
  baseToolNames: d.baseToolNames,
  subSkills: d.subSkills,
}));

describe.each(DOMAIN_CASES)(
  "$domain tool coverage",
  ({ domain, tools, baseToolNames, subSkills }) => {
    const exported = exportedToolNames(tools);
    const referenced = referencedToolNames(baseToolNames, parkedToolNames(domain), subSkills);

    it("has no orphan tools (exported but neither reachable nor parked)", () => {
      const orphans = exported.filter((name) => !referenced.has(name));
      expect(
        orphans,
        `${domain}: orphan tool(s) — wire into a SKILL.md / baseToolNames, disable via a _-prefixed sub-skill, or delete`,
      ).toEqual([]);
    });

    it("has no dangling references (SKILL.md/baseToolNames naming a missing tool)", () => {
      const dangling = [...referenced].filter((name) => !exported.includes(name));
      expect(dangling).toEqual([]);
    });

    it("defines every tool through defineTool with name and domain matching", () => {
      for (const [exportName, t] of Object.entries(tools)) {
        if (!exported.includes(exportName)) continue;
        const meta = getToolMeta(t);
        expect(meta, `${exportName} must be built with defineTool`).not.toBeNull();
        expect(meta?.name).toBe(exportName);
        expect(meta?.domain).toBe(domain);
      }
    });
  },
);
