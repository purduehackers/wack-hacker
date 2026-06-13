import { describe, expect, it, vi } from "vitest";

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
 * reachable by the model — either always-on via the domain's `baseToolNames`
 * or activated by a sub-skill's `tools:` list. Orphan tools are dead weight:
 * wire them into a SKILL.md or delete them. (knip can't catch these —
 * `src/lib/ai/tools/**` is in its ignore list.)
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
  subSkills: Record<string, { toolNames: readonly string[] }>,
): Set<string> {
  const referenced = new Set<string>(baseToolNames);
  for (const skill of Object.values(subSkills)) {
    for (const name of skill.toolNames) referenced.add(name);
  }
  return referenced;
}

const DOMAIN_CASES = Object.entries(DOMAINS).map(([domain, d]) => ({
  domain,
  tools: d.tools as unknown as Record<string, unknown>,
  baseToolNames: d.baseToolNames,
  subSkills: d.subSkills,
}));

/**
 * Pre-existing orphans, surfaced when coverage was extended from 2 → all
 * domains. Each is an exported tool no sub-skill or `baseToolNames` reaches, so
 * the model can never call it. This is a burn-down baseline, NOT an exemption
 * list: wire each into a SKILL.md (or delete it), then remove it here. The test
 * fails on any NEW orphan and on any stale entry, so the list can only shrink.
 */
const KNOWN_ORPHANS: Record<string, readonly string[]> = {
  figma: ["get_me"],
  sales: ["set_company_last_outreach", "set_contact_last_outreach", "send_outreach_email"],
  sentry: ["search_logs", "get_log_stats"],
  vercel: [
    "list_user_events",
    "list_event_types",
    "get_runtime_logs",
    "list_log_drains",
    "get_log_drain",
    "delete_configurable_log_drain",
    "list_integration_log_drains",
    "delete_integration_log_drain",
    "list_drains",
    "get_drain",
    "delete_drain",
    "get_observability_config",
    "update_observability_config",
    "artifacts_status",
    "artifact_exists",
    "artifact_query",
  ],
};

describe.each(DOMAIN_CASES)(
  "$domain tool coverage",
  ({ domain, tools, baseToolNames, subSkills }) => {
    const exported = exportedToolNames(tools);
    const referenced = referencedToolNames(baseToolNames, subSkills);

    it("has no orphan tools beyond the known baseline", () => {
      const orphans = exported.filter((name) => !referenced.has(name));
      const known = KNOWN_ORPHANS[domain] ?? [];
      expect(
        orphans.filter((name) => !known.includes(name)),
        `${domain}: NEW orphan tool(s) — wire into a SKILL.md / baseToolNames, or delete`,
      ).toEqual([]);
      expect(
        known.filter((name) => !orphans.includes(name)),
        `${domain}: stale KNOWN_ORPHANS entries (now reachable or removed) — delete them from the baseline`,
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
