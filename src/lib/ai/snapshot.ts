import { toJSONSchema } from "zod";

import type { ContextSnapshot, ToolDefSnapshot } from "@/bot/context-snapshot";

import type { AgentContext } from "./context.ts";
import type { ChatMessage, TurnUsage } from "./types.ts";

import { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";
import { getOrchestratorTools } from "./orchestrator.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

interface MinimalTool {
  description?: string;
  inputSchema?: unknown;
}

function describeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return {};
  // Zod v4 schemas carry a _zod marker; use the runtime-safe cast rather than
  // calling `instanceof ZodType` because the tool may come from any provider.
  const maybeZod = schema as { _zod?: unknown };
  if (maybeZod._zod !== undefined) {
    try {
      return toJSONSchema(schema as Parameters<typeof toJSONSchema>[0]);
    } catch {
      return {};
    }
  }
  return schema;
}

/**
 * Build a snapshot of the exact context the orchestrator assembled for this
 * turn. Uses the same code paths the orchestrator runs with (getOrchestratorTools,
 * AgentContext.buildInstructions) so the snapshot is the orchestrator's view.
 */
export function buildContextSnapshot(args: {
  agentCtx: AgentContext;
  messages: ChatMessage[];
  lastTurnUsage: TurnUsage;
  turnCount: number;
}): ContextSnapshot {
  const { agentCtx, messages, lastTurnUsage, turnCount } = args;

  // The tracker is write-only here — the snapshot only needs the tool set's
  // shape, not its accumulated counts.
  const toolSet = getOrchestratorTools(agentCtx.role, new TurnUsageTracker());

  const tools: ToolDefSnapshot[] = Object.entries(toolSet).map(([name, tool]) => {
    const t = tool as MinimalTool;
    return {
      name,
      description: t.description ?? "",
      inputSchema: describeSchema(t.inputSchema),
    };
  });

  return {
    model: ORCHESTRATOR_MODEL,
    context: agentCtx.toJSON(),
    systemPrompt: agentCtx.buildInstructions(SYSTEM_PROMPT),
    tools,
    messages,
    lastTurnUsage,
    turnCount,
    updatedAt: new Date().toISOString(),
  };
}
