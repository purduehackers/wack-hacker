import { ToolLoopAgent, type ToolSet } from "ai";

import type { TurnUsageTracker } from "./turn-usage.ts";
import type { TelemetryMetadata } from "./types.ts";

import { wrapApprovalTools } from "./approvals/index.ts";
import { addCacheControl } from "./cache-control.ts";
import { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";
import { AgentContext } from "./context.ts";
import { buildDelegateDocs, buildDelegationTools } from "./delegates.ts";
import { documentation } from "./tools/docs/index.ts";
import { resolve_organizer } from "./tools/roster/index.ts";
import { createScheduleTask, list_scheduled_tasks, cancel_task } from "./tools/schedule/index.ts";
import { web_search } from "./tools/search/index.ts";

export { ORCHESTRATOR_MODEL, SYSTEM_PROMPT } from "./constants.ts";

/**
 * Build the exact orchestrator tool surface for the scheduler's context.
 * Exported so the context inspector can snapshot the same tool set the
 * orchestrator runs with. Takes the full `AgentContext` because role-aware
 * tools (delegates, schedule_task) need both the resolved role and the
 * scheduler's `memberRoles` for propagation into persisted task meta.
 *
 * `extraMetadata` flows through to every delegation subagent so the whole
 * chat trace shares `chat.*` attributes without baggage plumbing.
 */
export function getOrchestratorTools(
  context: AgentContext,
  tracker: TurnUsageTracker,
  extraMetadata?: TelemetryMetadata,
): ToolSet {
  const tools: ToolSet = {
    documentation,
    resolve_organizer,
    schedule_task: createScheduleTask(context),
    list_scheduled_tasks,
    cancel_task,
    web_search,
    ...buildDelegationTools(context, tracker, extraMetadata),
  };
  return wrapApprovalTools(tools, { context });
}

/**
 * Render the orchestrator's full system prompt for the caller's context. The
 * `{{DELEGATES}}` section is generated from the same registry that builds the
 * delegation tools, so the prompt documents exactly the delegate tools the
 * role has (and collapses to nothing for roles with none). The context
 * inspector's snapshot uses this same function — keep it the single render
 * path.
 */
export function buildSystemPrompt(context: AgentContext): string {
  const docs = buildDelegateDocs(context.role);
  const base = docs
    ? SYSTEM_PROMPT.replace("{{DELEGATES}}", docs)
    : SYSTEM_PROMPT.replace("\n\n{{DELEGATES}}", "");
  return context.buildInstructions(base);
}

export function createOrchestrator(
  context: AgentContext,
  tracker: TurnUsageTracker,
  extraMetadata: TelemetryMetadata | undefined,
  model: string,
) {
  const instructions = buildSystemPrompt(context);
  // Cache-control on the tools block is applied once at construction:
  // `PrepareStepResult` in ai@6 has no `tools` field, so a per-step override
  // would be silently ignored — and the orchestrator's tool set never changes
  // mid-turn anyway. The breakpoint lands on the last tool, which requires the
  // serialized tool order to stay byte-stable across steps; reusing this one
  // object for every step guarantees that.
  const tools = addCacheControl({
    tools: getOrchestratorTools(context, tracker, extraMetadata),
    model: ORCHESTRATOR_MODEL,
  });

  return new ToolLoopAgent({
    model,
    instructions,
    tools,
    // Re-mark the trailing message each step so the conversation prefix caches
    // incrementally. Two breakpoints total (last tool + last message) — well
    // under Anthropic's 4-breakpoint limit.
    prepareStep: ({ messages }) => ({
      messages: addCacheControl({ messages, model: ORCHESTRATOR_MODEL }),
    }),
    experimental_telemetry: {
      isEnabled: true,
      functionId: "orchestrator",
      metadata: {
        role: context.role,
        ...extraMetadata,
      },
    },
  });
}
