import type { ContextBreakdown } from "@/lib/ai/inspect-context";

const HEADER_PREFIX = "**Context Usage** — live snapshot";

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function renderContextReport(breakdown: ContextBreakdown): string {
  const { model, modelInfo, categories, estimatedInputTokens, lastTurnUsage, lastTurnCostUsd } =
    breakdown;

  const lines: string[] = [];
  lines.push(`${HEADER_PREFIX} (turn #${breakdown.turnCount})`);

  const modelIdSuffix = modelInfo ? ` (${modelInfo.id})` : "";
  lines.push(`\`Model\`: ${model}${modelIdSuffix}`);

  if (modelInfo) {
    lines.push(`\`Window\`: ${formatTokens(modelInfo.limit.context)} tokens`);
  } else {
    lines.push(`\`Window\`: unknown (model not in models.dev catalog)`);
  }

  const usageParts: string[] = [];
  if (lastTurnUsage.inputTokens != null) {
    usageParts.push(`input ${formatTokens(lastTurnUsage.inputTokens)}`);
  }
  if (lastTurnUsage.outputTokens != null) {
    usageParts.push(`output ${formatTokens(lastTurnUsage.outputTokens)}`);
  }
  if (lastTurnUsage.subagentTokens > 0) {
    usageParts.push(`subagents ${formatTokens(lastTurnUsage.subagentTokens)}`);
  }
  usageParts.push(`tools ${lastTurnUsage.toolCallCount}`);
  usageParts.push(`steps ${lastTurnUsage.stepCount}`);
  lines.push(`\`Last turn\` (from API): ${usageParts.join(" · ")}`);

  if (lastTurnCostUsd) {
    lines.push(
      `\`Last turn cost\`: ${formatCost(lastTurnCostUsd.total)} (input ${formatCost(lastTurnCostUsd.input)} + output ${formatCost(lastTurnCostUsd.output)})`,
    );
  }

  lines.push("");
  lines.push("Estimated input breakdown (chars/4):");

  const window = modelInfo?.limit.context;
  for (const c of categories) {
    const percent = window ? ` (${formatPercent(c.estimatedTokens, window)})` : "";
    const suffix =
      c.label === "Conversation history" ? ` — ${breakdown.messageCount} messages` : "";
    lines.push(`• **${c.label}**: ~${formatTokens(c.estimatedTokens)} tokens${percent}${suffix}`);
  }

  const totalPercent = window ? ` (${formatPercent(estimatedInputTokens, window)})` : "";
  lines.push(
    `• **Total input (estimated)**: ~${formatTokens(estimatedInputTokens)} tokens${totalPercent}`,
  );

  if (window) {
    const free = Math.max(window - estimatedInputTokens, 0);
    lines.push(`• **Free space**: ~${formatTokens(free)} tokens (${formatPercent(free, window)})`);
  }

  lines.push("");
  lines.push(
    "-# Per-category counts estimated with chars/4. Last-turn totals and dollar cost are exact (from API usage × models.dev pricing).",
  );

  return lines.join("\n");
}
