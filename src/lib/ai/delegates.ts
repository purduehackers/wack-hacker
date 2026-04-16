import type { ToolSet } from "ai";

import type { UserRole } from "./constants.ts";
import type { SubagentMetrics } from "./types.ts";

import { SKILL_MANIFEST as DISCORD_SUBSKILLS } from "./skills/generated/domains/discord.ts";
import { SKILL_MANIFEST as FIGMA_SUBSKILLS } from "./skills/generated/domains/figma.ts";
import { SKILL_MANIFEST as GITHUB_SUBSKILLS } from "./skills/generated/domains/github.ts";
import { SKILL_MANIFEST as LINEAR_SUBSKILLS } from "./skills/generated/domains/linear.ts";
import { SKILL_MANIFEST as NOTION_SUBSKILLS } from "./skills/generated/domains/notion.ts";
import { SKILL_MANIFEST } from "./skills/generated/manifest.ts";
import { SkillRegistry } from "./skills/registry.ts";
import { createDelegationTool } from "./subagent.ts";
import * as discordTools from "./tools/discord/index.ts";
import * as figmaTools from "./tools/figma/index.ts";
import * as githubTools from "./tools/github/index.ts";
import * as linearTools from "./tools/linear/index.ts";
import * as notionTools from "./tools/notion/index.ts";

const DELEGATE_PREFIX = "delegate_";

/**
 * Per-domain configuration for delegation subagents.
 *
 * `tools` is the full domain tool set. `baseToolNames` are the tools always
 * visible to the subagent without loading a sub-skill — typically search and
 * retrieval tools that serve as the agent's initial discovery toolkit.
 */
const DOMAINS = {
  linear: {
    tools: linearTools as unknown as ToolSet,
    subSkills: LINEAR_SUBSKILLS,
    baseToolNames: [
      "search_entities",
      "retrieve_entities",
      "suggest_property_values",
      "aggregate_issues",
    ],
  },
  github: {
    tools: githubTools as unknown as ToolSet,
    subSkills: GITHUB_SUBSKILLS,
    baseToolNames: ["list_repositories", "get_repository", "search_code", "search_issues"],
  },
  discord: {
    tools: discordTools as unknown as ToolSet,
    subSkills: DISCORD_SUBSKILLS,
    baseToolNames: ["get_server_info", "list_channels", "list_roles", "search_members"],
  },
  figma: {
    tools: figmaTools as unknown as ToolSet,
    subSkills: FIGMA_SUBSKILLS,
    baseToolNames: ["get_file", "list_projects", "list_project_files", "search_files"],
  },
  notion: {
    tools: notionTools as unknown as ToolSet,
    subSkills: NOTION_SUBSKILLS,
    baseToolNames: ["search_notion", "retrieve_page", "retrieve_database", "list_users"],
  },
} as const satisfies Record<
  string,
  { tools: ToolSet; subSkills: unknown; baseToolNames: readonly string[] }
>;

const registry = new SkillRegistry(SKILL_MANIFEST);

/** Build delegation tools for every delegate-mode skill the role can access. */
export function buildDelegationTools(role: UserRole, metrics: SubagentMetrics): ToolSet {
  const tools: ToolSet = {};
  for (const [name, config] of Object.entries(DOMAINS)) {
    const skill = registry.loadSkill(name, role);
    if (!skill || skill.mode !== "delegate") continue;
    tools[DELEGATE_PREFIX + name] = createDelegationTool(
      {
        name,
        description: skill.description,
        systemPrompt: skill.instructions,
        ...config,
      },
      role,
      metrics,
    );
  }
  return tools;
}
