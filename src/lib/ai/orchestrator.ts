import { ToolLoopAgent, type ToolSet } from "ai";

import type { UserRole } from "./constants.ts";
import type { SubagentMetrics } from "./types.ts";

import { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";
import { AgentContext } from "./context.ts";
import { buildDelegationTools } from "./delegates.ts";
import { documentation } from "./tools/docs/index.ts";
import { scheduleTask, listScheduledTasks, cancelTask } from "./tools/schedule/index.ts";
import { currentTime } from "./tools/schedule/time.ts";

export { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";

/**
 * Build the exact orchestrator tool surface for a given role. Exported so the
 * context inspector can snapshot the same tool set the orchestrator runs with.
 */
export function getOrchestratorTools(role: UserRole, metrics: SubagentMetrics): ToolSet {
  return {
    currentTime,
    documentation,
    scheduleTask,
    listScheduledTasks,
    cancelTask,
    ...buildDelegationTools(role, metrics),
  };
}

export function createOrchestrator(context: AgentContext, metrics: SubagentMetrics) {
  const instructions = context.buildInstructions(SYSTEM_PROMPT);
  const tools = getOrchestratorTools(context.role, metrics);

  return new ToolLoopAgent({
    model: ORCHESTRATOR_MODEL,
    instructions,
    tools,
    experimental_telemetry: {
      isEnabled: true,
      functionId: "orchestrator",
      metadata: {
        role: context.role,
      },
    },
  });
}
