import type { ToolSet } from "ai";

import type { AgentContext } from "./context.ts";
import type { TurnUsageTracker } from "./turn-usage.ts";
import type { SubagentSpec } from "./types.ts";

import { SKILL_MANIFEST as CODE_SUBSKILLS } from "./skills/generated/domains/code.ts";
import { SKILL_MANIFEST as DISCORD_SUBSKILLS } from "./skills/generated/domains/discord.ts";
import { SKILL_MANIFEST as FIGMA_SUBSKILLS } from "./skills/generated/domains/figma.ts";
import { SKILL_MANIFEST as FINANCE_SUBSKILLS } from "./skills/generated/domains/finance.ts";
import { SKILL_MANIFEST as GITHUB_SUBSKILLS } from "./skills/generated/domains/github.ts";
import { SKILL_MANIFEST as LINEAR_SUBSKILLS } from "./skills/generated/domains/linear.ts";
import { SKILL_MANIFEST as NOTION_SUBSKILLS } from "./skills/generated/domains/notion.ts";
import { SKILL_MANIFEST as SALES_SUBSKILLS } from "./skills/generated/domains/sales.ts";
import { SKILL_MANIFEST as SENTRY_SUBSKILLS } from "./skills/generated/domains/sentry.ts";
import { SKILL_MANIFEST as SHOPPING_SUBSKILLS } from "./skills/generated/domains/shopping.ts";
import { SKILL_MANIFEST as VERCEL_SUBSKILLS } from "./skills/generated/domains/vercel.ts";
import { SKILL_MANIFEST } from "./skills/generated/manifest.ts";
import { SkillRegistry } from "./skills/registry.ts";
import { createDelegationTool } from "./subagent.ts";
import {
  buildCodeExperimentalContext,
  codeDelegationInputSchema,
  codePostFinish,
} from "./tools/code/delegation.ts";
import * as codeTools from "./tools/code/index.ts";
import * as discordTools from "./tools/discord/index.ts";
import * as figmaTools from "./tools/figma/index.ts";
import * as financeTools from "./tools/finance/index.ts";
import * as githubTools from "./tools/github/index.ts";
import * as linearTools from "./tools/linear/index.ts";
import * as notionTools from "./tools/notion/index.ts";
import * as salesTools from "./tools/sales/index.ts";
import * as sentryTools from "./tools/sentry/index.ts";
import * as shoppingTools from "./tools/shopping/index.ts";
import * as vercelTools from "./tools/vercel/index.ts";

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
  sentry: {
    tools: sentryTools as unknown as ToolSet,
    subSkills: SENTRY_SUBSKILLS,
    baseToolNames: ["list_projects", "get_project", "search_issues", "get_issue"],
  },
  finance: {
    tools: financeTools as unknown as ToolSet,
    subSkills: FINANCE_SUBSKILLS,
    baseToolNames: ["get_organization", "get_balance", "list_transactions", "get_transaction"],
  },
  shopping: {
    tools: shoppingTools as unknown as ToolSet,
    subSkills: SHOPPING_SUBSKILLS,
    baseToolNames: ["search_products", "view_cart"],
  },
  sales: {
    tools: salesTools as unknown as ToolSet,
    subSkills: SALES_SUBSKILLS,
    baseToolNames: [
      "list_companies",
      "list_contacts",
      "list_deals",
      "get_company",
      "get_contact",
      "get_deal",
      "retrieve_crm_schema",
    ],
  },
  vercel: {
    tools: vercelTools as unknown as ToolSet,
    subSkills: VERCEL_SUBSKILLS,
    baseToolNames: [
      "list_projects",
      "get_project",
      "list_deployments",
      "get_deployment",
      "list_aliases",
      "list_domains",
      "whoami",
      "list_teams",
    ],
  },
  code: {
    tools: codeTools as unknown as ToolSet,
    subSkills: CODE_SUBSKILLS,
    baseToolNames: ["read", "grep", "glob", "list_dir", "todo_write"],
  },
} as const satisfies Record<
  string,
  { tools: ToolSet; subSkills: unknown; baseToolNames: readonly string[] }
>;

/**
 * Per-domain overrides layered into the `SubagentSpec` before creating the
 * delegation tool. Today only `code` needs non-default values — stronger
 * model, more steps, custom input schema, sandbox context builder, and the
 * post-finish commit/push/PR step. Other domains use the defaults.
 */
const DOMAIN_SPEC_OVERRIDES: Partial<Record<keyof typeof DOMAINS, Partial<SubagentSpec>>> = {
  code: {
    model: "anthropic/claude-opus-4.7",
    stopSteps: 60,
    inputSchema: codeDelegationInputSchema,
    buildExperimentalContext: buildCodeExperimentalContext,
    postFinish: codePostFinish,
  },
};

const registry = new SkillRegistry(SKILL_MANIFEST);

/** Build delegation tools for every delegate-mode skill the role can access. */
export function buildDelegationTools(context: AgentContext, tracker: TurnUsageTracker): ToolSet {
  const tools: ToolSet = {};
  for (const [name, config] of Object.entries(DOMAINS)) {
    const skill = registry.loadSkill(name, context.role);
    if (!skill || skill.mode !== "delegate") continue;
    const overrides = DOMAIN_SPEC_OVERRIDES[name as keyof typeof DOMAINS] ?? {};
    tools[DELEGATE_PREFIX + name] = createDelegationTool(
      {
        name,
        description: skill.description,
        systemPrompt: skill.instructions,
        ...config,
        ...overrides,
      },
      context,
      tracker,
    );
  }
  return tools;
}
