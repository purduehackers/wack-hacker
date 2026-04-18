import type { CategoryBreakdown, CategoryItem, ContextBreakdown } from "@/lib/ai/inspect-context";

const HEADER_PREFIX = "**Context Usage**";
const DISCORD_MAX = 1900; // leave headroom under Discord's 2000 hard limit

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

function categorySuffix(c: CategoryBreakdown, messageCount: number): string {
  if (c.label === "Conversation history") {
    return ` — ${messageCount} messages`;
  }
  if (c.items?.length) {
    const noun = c.items.length === 1 ? "entry" : "entries";
    return ` — ${c.items.length} ${noun}`;
  }
  return "";
}

function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural;
}

/**
 * Pack independent chunks into Discord-sized message pages. Each page stays
 * under DISCORD_MAX chars; chunks are kept whole (never split mid-chunk).
 */
function packPages(blocks: string[]): string[] {
  const pages: string[] = [];
  let current = "";
  for (const next of blocks) {
    if (!next) continue;
    const sep = current ? "\n\n" : "";
    if (current.length + sep.length + next.length <= DISCORD_MAX) {
      current += sep + next;
    } else {
      if (current) pages.push(current);
      current = next;
    }
  }
  if (current) pages.push(current);
  return pages;
}

export function renderContextReport(breakdown: ContextBreakdown): string[] {
  const blocks: string[] = [renderSummary(breakdown), ...renderDetailBlocks(breakdown)];
  return packPages(blocks);
}

function renderSummary(breakdown: ContextBreakdown): string {
  const { model, modelInfo, categories, estimatedInputTokens, totalUsage, totalCostUsd } =
    breakdown;
  const lines: string[] = [];

  const exchanges = breakdown.turnCount === 1 ? "1 exchange" : `${breakdown.turnCount} exchanges`;
  lines.push(`${HEADER_PREFIX} (after ${exchanges})`);

  const modelIdSuffix = modelInfo ? ` (${modelInfo.id})` : "";
  lines.push(`\`Model\`: ${model}${modelIdSuffix}`);

  if (modelInfo) {
    lines.push(`\`Window\`: ${formatTokens(modelInfo.limit.context)} tokens`);
  } else {
    lines.push(`\`Window\`: unknown (model not in models.dev catalog)`);
  }

  const usageParts: string[] = [
    `${formatTokens(totalUsage.inputTokens)} input`,
    `${formatTokens(totalUsage.outputTokens)} output`,
  ];
  if (totalUsage.subagentTokens > 0) {
    usageParts.push(`${formatTokens(totalUsage.subagentTokens)} subagent`);
  }
  usageParts.push(`${totalUsage.toolCallCount} tool calls`);
  usageParts.push(`${totalUsage.stepCount} steps`);
  lines.push(`\`Conversation totals\` (sum of every turn, from API): ${usageParts.join(" · ")}`);

  if (totalCostUsd) {
    lines.push(
      `\`Conversation cost\`: ${formatCost(totalCostUsd.total)} (input ${formatCost(totalCostUsd.input)} + output ${formatCost(totalCostUsd.output)})`,
    );
  }

  lines.push("");
  lines.push(
    "Estimated next-request breakdown — what the model would see on the next turn (chars/4):",
  );

  const window = modelInfo?.limit.context;
  for (const c of categories) {
    const percent = window ? ` (${formatPercent(c.estimatedTokens, window)})` : "";
    const suffix = categorySuffix(c, breakdown.messageCount);
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

  return lines.join("\n");
}

/**
 * Build one block per detail category. Each delegate item also emits its own
 * standalone block so packPages can flush a page boundary between delegates if
 * the cumulative content would overflow Discord's 1900-char chunk size.
 */
function renderDetailBlocks(breakdown: ContextBreakdown): string[] {
  const out: string[] = [];
  for (const category of breakdown.categories) {
    if (!category.items?.length) continue;
    if (category.label === "Delegate agents") {
      out.push(...renderDelegateBlocks(category.items));
    } else {
      out.push(renderFlatCategory(category));
    }
  }
  return out;
}

function renderFlatCategory(category: CategoryBreakdown): string {
  const lines: string[] = [`**${category.label}** (${category.items?.length ?? 0})`];
  for (const item of category.items ?? []) {
    lines.push(`• \`${item.name}\`: ~${formatTokens(item.estimatedTokens)} tokens`);
  }
  return lines.join("\n");
}

function renderDelegateBlocks(delegateItems: NonNullable<CategoryBreakdown["items"]>): string[] {
  const out: string[] = [`**Delegate agents** (${delegateItems.length}, with loadable subskills)`];
  for (const delegate of delegateItems) {
    out.push(...renderDelegateChunks(delegate));
  }
  return out;
}

function renderDelegateChunks(delegate: CategoryItem): string[] {
  const headLines: string[] = [
    `\`${delegate.name}\`: ~${formatTokens(delegate.estimatedTokens)} tokens`,
  ];
  if (!delegate.skills?.length) {
    headLines.push("Loadable skills: none");
    return [headLines.join("\n")];
  }

  const noun = pluralize(delegate.skills.length, "skill");
  headLines.push(`Loadable ${noun} (${delegate.skills.length}):`);

  const skillLines = delegate.skills.map(
    (s) => `• \`${s.name}\`: ~${formatTokens(s.estimatedTokens)} tokens`,
  );

  const out: string[] = [];
  let current = headLines.join("\n");
  for (const line of skillLines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length <= DISCORD_MAX) {
      current = candidate;
    } else {
      out.push(current);
      current = `\`${delegate.name}\` (continued)\n${line}`;
    }
  }
  out.push(current);
  return out;
}
