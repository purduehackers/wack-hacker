import type { ContextSnapshot } from "@/bot/context-snapshot";

import type { CategoryBreakdown, ContextBreakdown, ModelInfo } from "./types.ts";

import { fetchModelInfo } from "./models-dev.ts";

export type { CategoryBreakdown, ContextBreakdown, ModelInfo } from "./types.ts";

/** Chars/4 heuristic. Clearly labeled as estimated in the rendered output. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function renderToolsText(snap: ContextSnapshot): string {
  return JSON.stringify(snap.tools);
}

function renderMessagesText(snap: ContextSnapshot): string {
  return snap.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

function buildCategories(snap: ContextSnapshot): CategoryBreakdown[] {
  const systemPromptText = snap.systemPrompt;
  const toolsText = renderToolsText(snap);
  const messagesText = renderMessagesText(snap);

  return [
    {
      label: "System prompt",
      chars: systemPromptText.length,
      estimatedTokens: estimateTokens(systemPromptText),
    },
    {
      label: "Tools",
      chars: toolsText.length,
      estimatedTokens: estimateTokens(toolsText),
    },
    {
      label: "Conversation history",
      chars: messagesText.length,
      estimatedTokens: estimateTokens(messagesText),
    },
  ];
}

function computeCost(
  modelInfo: ModelInfo | null,
  usage: ContextSnapshot["lastTurnUsage"],
): ContextBreakdown["lastTurnCostUsd"] | undefined {
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
  const categories = buildCategories(snap);
  const estimatedInputTokens = categories.reduce((sum, c) => sum + c.estimatedTokens, 0);

  return {
    model: snap.model,
    modelInfo,
    categories,
    estimatedInputTokens,
    lastTurnUsage: snap.lastTurnUsage,
    turnCount: snap.turnCount,
    messageCount: snap.messages.length,
    lastTurnCostUsd: computeCost(modelInfo, snap.lastTurnUsage),
  };
}
