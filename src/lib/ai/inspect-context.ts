import type { ContextSnapshot, ToolDefSnapshot } from "@/bot/context-snapshot";

import type { UserRole } from "./constants.ts";
import type { SkillBundle } from "./skills/types.ts";
import type { CategoryBreakdown, CategoryItem, ContextBreakdown, ModelInfo } from "./types.ts";

import { AgentContext } from "./context.ts";
import { fetchModelInfo } from "./models-dev.ts";
import { SKILL_MANIFEST as DISCORD_SUBSKILLS } from "./skills/generated/domains/discord.ts";
import { SKILL_MANIFEST as FIGMA_SUBSKILLS } from "./skills/generated/domains/figma.ts";
import { SKILL_MANIFEST as GITHUB_SUBSKILLS } from "./skills/generated/domains/github.ts";
import { SKILL_MANIFEST as LINEAR_SUBSKILLS } from "./skills/generated/domains/linear.ts";
import { SKILL_MANIFEST as NOTION_SUBSKILLS } from "./skills/generated/domains/notion.ts";
import { SKILL_MANIFEST as SENTRY_SUBSKILLS } from "./skills/generated/domains/sentry.ts";
import { SkillRegistry } from "./skills/registry.ts";

export type { CategoryBreakdown, CategoryItem, ContextBreakdown, ModelInfo } from "./types.ts";

const DELEGATE_PREFIX = "delegate_";

/**
 * Domain → subskill manifest. Subskills are loaded on demand inside delegate
 * subagents (via load_skill); they don't enter the orchestrator's window. The
 * inspector lists them under each delegate so organizers can see what's
 * loadable without those tokens inflating the input estimate.
 */
const DOMAIN_SUBSKILLS: Record<string, Record<string, SkillBundle>> = {
  linear: LINEAR_SUBSKILLS,
  github: GITHUB_SUBSKILLS,
  discord: DISCORD_SUBSKILLS,
  notion: NOTION_SUBSKILLS,
  figma: FIGMA_SUBSKILLS,
  sentry: SENTRY_SUBSKILLS,
};

function loadableSkillsFor(domain: string, role: UserRole): CategoryItem[] | undefined {
  const manifest = DOMAIN_SUBSKILLS[domain];
  if (!manifest) return undefined;
  const skills = new SkillRegistry(manifest).getAvailableSkills(role);
  if (skills.length === 0) return undefined;
  return skills.map((meta) => ({
    name: meta.name,
    estimatedTokens: estimateTokens(JSON.stringify(manifest[meta.name])),
  }));
}

/** Chars/4 heuristic. Clearly labeled as estimated in the rendered output. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Per-tool token estimate based on the JSON-serialized tool definition. */
function toolItem(tool: ToolDefSnapshot): CategoryItem {
  return {
    name: tool.name,
    estimatedTokens: estimateTokens(JSON.stringify(tool)),
  };
}

function delegateItem(tool: ToolDefSnapshot, role: UserRole): CategoryItem {
  const domain = tool.name.slice(DELEGATE_PREFIX.length);
  return {
    name: tool.name,
    estimatedTokens: estimateTokens(JSON.stringify(tool)),
    skills: loadableSkillsFor(domain, role),
  };
}

function partitionTools(tools: ToolDefSnapshot[]): {
  baseTools: ToolDefSnapshot[];
  delegates: ToolDefSnapshot[];
} {
  const baseTools: ToolDefSnapshot[] = [];
  const delegates: ToolDefSnapshot[] = [];
  for (const t of tools) {
    if (t.name.startsWith(DELEGATE_PREFIX)) delegates.push(t);
    else baseTools.push(t);
  }
  return { baseTools, delegates };
}

function categoryFromTools(
  label: string,
  tools: ToolDefSnapshot[],
  buildItem: (t: ToolDefSnapshot) => CategoryItem,
): CategoryBreakdown {
  const text = JSON.stringify(tools);
  return {
    label,
    chars: text.length,
    estimatedTokens: estimateTokens(text),
    items: tools.map(buildItem),
  };
}

function renderMessagesText(snap: ContextSnapshot): string {
  return snap.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

function buildCategories(snap: ContextSnapshot, role: UserRole): CategoryBreakdown[] {
  const systemPromptText = snap.systemPrompt;
  const messagesText = renderMessagesText(snap);
  const { baseTools, delegates } = partitionTools(snap.tools);

  return [
    {
      label: "System prompt",
      chars: systemPromptText.length,
      estimatedTokens: estimateTokens(systemPromptText),
    },
    categoryFromTools("Tools", baseTools, toolItem),
    categoryFromTools("Delegate agents", delegates, (t) => delegateItem(t, role)),
    {
      label: "Conversation history",
      chars: messagesText.length,
      estimatedTokens: estimateTokens(messagesText),
    },
  ];
}

function computeCost(
  modelInfo: ModelInfo | null,
  usage: ContextSnapshot["totalUsage"],
): ContextBreakdown["totalCostUsd"] | undefined {
  if (!modelInfo) return undefined;
  if (usage.inputTokens == null && usage.outputTokens == null) return undefined;
  const inputCost = ((usage.inputTokens ?? 0) * modelInfo.cost.input) / 1_000_000;
  const outputCost = ((usage.outputTokens ?? 0) * modelInfo.cost.output) / 1_000_000;
  return {
    input: inputCost,
    output: outputCost,
    total: inputCost + outputCost,
  };
}

export async function breakdownFromSnapshot(
  snap: ContextSnapshot,
  fetchInfo: (id: string) => Promise<ModelInfo | null> = fetchModelInfo,
): Promise<ContextBreakdown> {
  const modelInfo = await fetchInfo(snap.model);
  const role = AgentContext.fromJSON(snap.context).role;
  const categories = buildCategories(snap, role);
  const estimatedInputTokens = categories.reduce((sum, c) => sum + c.estimatedTokens, 0);

  return {
    model: snap.model,
    modelInfo,
    categories,
    estimatedInputTokens,
    totalUsage: snap.totalUsage,
    turnCount: snap.turnCount,
    messageCount: snap.messages.length,
    totalCostUsd: computeCost(modelInfo, snap.totalUsage),
  };
}
