import { describe, expect, it } from "vitest";

import { BASE_TOOL_NAMES } from "../constants.ts";
import { SKILL_MANIFEST as FINANCE_SUBSKILLS } from "../skills/generated/domains/finance.ts";
import { SKILL_MANIFEST as SHOPPING_SUBSKILLS } from "../skills/generated/domains/shopping.ts";
import { getToolMeta } from "./_shared/define-tool.ts";
import * as financeTools from "./finance/index.ts";
import * as shoppingTools from "./shopping/index.ts";

/**
 * Coverage manifest for domains migrated to `defineTool`. Every exported tool
 * must be reachable by the model — either always-on via the domain's
 * `baseToolNames` or activated by a sub-skill's `tools:` list. Orphan tools
 * are dead weight: wire them into a SKILL.md or delete them. (knip can't
 * catch these — `src/lib/ai/tools/**` is in its ignore list.)
 *
 * Extend MIGRATED_DOMAINS as more domains move to the factory.
 */
const MIGRATED_DOMAINS = [
  { domain: "shopping", tools: shoppingTools, subSkills: SHOPPING_SUBSKILLS },
  { domain: "finance", tools: financeTools, subSkills: FINANCE_SUBSKILLS },
] as const;

function exportedToolNames(tools: Record<string, unknown>): string[] {
  return Object.entries(tools)
    .filter(([, t]) => t && typeof t === "object" && "inputSchema" in (t as object))
    .map(([name]) => name);
}

function referencedToolNames(
  domain: keyof typeof BASE_TOOL_NAMES,
  subSkills: Record<string, { toolNames: readonly string[] }>,
): Set<string> {
  const referenced = new Set<string>(BASE_TOOL_NAMES[domain]);
  for (const skill of Object.values(subSkills)) {
    for (const name of skill.toolNames) referenced.add(name);
  }
  return referenced;
}

describe.each(MIGRATED_DOMAINS)("$domain tool coverage", ({ domain, tools, subSkills }) => {
  const exported = exportedToolNames(tools);
  const referenced = referencedToolNames(domain, subSkills);

  it("has no orphan tools (exported but unreachable by the model)", () => {
    const orphans = exported.filter((name) => !referenced.has(name));
    expect(orphans).toEqual([]);
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
});
