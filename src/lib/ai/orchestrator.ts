import { ToolLoopAgent, type ToolSet } from "ai";

import type { TurnUsageTracker } from "./turn-usage.ts";

import { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";
import { AgentContext } from "./context.ts";
import { buildDelegationTools } from "./delegates.ts";
import { documentation } from "./tools/docs/index.ts";
import { resolve_organizer } from "./tools/roster/index.ts";
import { createScheduleTask, listScheduledTasks, cancelTask } from "./tools/schedule/index.ts";
import { currentTime } from "./tools/schedule/time.ts";

export { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";

/**
 * Build the exact orchestrator tool surface for the scheduler's context.
 * Exported so the context inspector can snapshot the same tool set the
 * orchestrator runs with. Takes the full `AgentContext` because role-aware
 * tools (delegates, scheduleTask) need both the resolved role and the
 * scheduler's `memberRoles` for propagation into persisted task meta.
 */
export function getOrchestratorTools(context: AgentContext, tracker: TurnUsageTracker): ToolSet {
  return {
    currentTime,
    documentation,
    resolve_organizer,
    scheduleTask: createScheduleTask(context),
    listScheduledTasks,
    cancelTask,
    ...buildDelegationTools(context.role, tracker),
  };
}

export function createOrchestrator(context: AgentContext, tracker: TurnUsageTracker) {
  const instructions = context.buildInstructions(SYSTEM_PROMPT);
  const tools = getOrchestratorTools(context, tracker);

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
