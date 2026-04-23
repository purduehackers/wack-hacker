import {
  ToolLoopAgent,
  tool,
  stepCountIs,
  readUIMessageStream,
  isTextUIPart,
  type ModelMessage,
  type StepResult,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution } from "@/lib/metrics";

import type { AgentContext } from "./context.ts";
import type { SubagentSpec, TelemetryMetadata } from "./types.ts";

import { wrapApprovalTools } from "./approvals/index.ts";
import { addCacheControl } from "./cache-control.ts";
import { SUBAGENT_MODEL, SUBAGENT_PREAMBLE, UserRole } from "./constants.ts";
import {
  SkillRegistry,
  createLoadSkillTool,
  computeActiveTools,
  filterAdmin,
} from "./skills/index.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

export type { SubagentSpec } from "./types.ts";

const DEFAULT_TASK_INPUT_SCHEMA = z.object({
  task: z.string().describe("The task to delegate, forwarded verbatim"),
});

/** Shape of the AI SDK `result.steps` output we actually consume for metrics. */
type SubagentSteps = { toolCalls: { toolName?: string }[] }[];

/**
 * Create a delegation tool that spawns a focused domain subagent.
 *
 * Each invocation builds a nested `ToolLoopAgent` with the domain's system
 * prompt, tools, and sub-skills. The execute function is an async generator
 * that yields `UIMessage` snapshots from the subagent's stream — these surface
 * as preliminary tool results on the parent's stream so progress can be
 * relayed to Discord in real time.
 *
 * `toModelOutput` extracts only the final text part so the orchestrator's
 * message history stays lean (full execution details live in the UI stream,
 * not in the model context).
 */
/**
 * Push subagent usage into the TurnUsageTracker and emit Sentry metrics.
 * Exported so we can unit-test the `?? 0` fallback for missing totalTokens
 * without driving a full mocked ToolLoopAgent.
 */
export function recordSubagentMetrics(
  tracker: TurnUsageTracker,
  spec: Pick<SubagentSpec, "name">,
  usage: { totalTokens?: number },
  steps: SubagentSteps,
): void {
  const tokens = usage.totalTokens ?? 0;
  const toolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const toolNames = steps.flatMap((s) =>
    s.toolCalls.flatMap((call) => (typeof call.toolName === "string" ? [call.toolName] : [])),
  );
  tracker.addSubagent({ tokens, toolCalls, toolNames });
  countMetric("ai.subagent.completed", { domain: spec.name });
  recordDistribution("ai.subagent.tokens", tokens, { domain: spec.name });
  recordDistribution("ai.subagent.tool_calls", toolCalls, { domain: spec.name });
  createWideLogger({
    op: "ai.subagent",
    subagent: { domain: spec.name },
  }).emit({
    outcome: "ok",
    tokens,
    tool_calls: toolCalls,
    tool_names: toolNames,
    steps: steps.length,
  });
}

/**
 * Build the `prepareStep` handler for a subagent's `ToolLoopAgent`. Returns
 * the combined active-tools update + Anthropic cache-control layering.
 * Exported so we can unit-test the active-vs-empty branch.
 */
export function buildPrepareStep(args: {
  registry: SkillRegistry;
  role: UserRole;
  baseToolNames: string[];
  tools: ToolSet;
  model: string;
}) {
  const { registry, role, baseToolNames, tools, model } = args;
  return ({ steps, messages }: { steps: StepResult<ToolSet>[]; messages: ModelMessage[] }) => {
    const active = computeActiveTools({ steps, registry, role, baseToolNames });
    return {
      ...(active ? { activeTools: active } : {}),
      tools: addCacheControl({ tools, model }),
      messages: addCacheControl({ messages, model }),
    };
  };
}

export function createDelegationTool(
  spec: SubagentSpec,
  context: AgentContext,
  tracker: TurnUsageTracker,
  extraMetadata?: TelemetryMetadata,
) {
  const role = context.role;
  const inputSchema = spec.inputSchema ?? DEFAULT_TASK_INPUT_SCHEMA;

  return tool({
    description: spec.description,
    inputSchema,
    execute: async function* (input, { abortSignal }) {
      const registry = new SkillRegistry(spec.subSkills);
      const loadSkill = createLoadSkillTool(registry, role);
      const instructions = `${SUBAGENT_PREAMBLE}\n\n${spec.systemPrompt.replace(
        "{{SKILL_MENU}}",
        registry.buildSkillMenu(role),
      )}`;

      const allTools: ToolSet = { ...spec.tools, loadSkill };
      const roleFiltered = role === UserRole.Admin ? allTools : filterAdmin(allTools);
      const tools = wrapApprovalTools(roleFiltered, {
        context,
        delegateName: spec.name,
      });
      const baseToolNames = [...spec.baseToolNames, "loadSkill"];
      type ToolKey = keyof typeof tools;
      const resolvedModel = spec.model ?? SUBAGENT_MODEL;

      const agent = new ToolLoopAgent({
        model: resolvedModel,
        instructions,
        tools,
        stopWhen: stepCountIs(spec.stopSteps ?? 15),
        activeTools: baseToolNames as ToolKey[],
        prepareStep: buildPrepareStep({
          registry,
          role,
          baseToolNames,
          tools,
          model: resolvedModel,
        }) as unknown as ConstructorParameters<
          typeof ToolLoopAgent<typeof tools>
        >[0]["prepareStep"],
        providerOptions: { openai: { parallelToolCalls: true } },
        experimental_telemetry: {
          isEnabled: true,
          functionId: `subagent.${spec.name}`,
          metadata: { role, subagent: spec.name, ...extraMetadata },
        },
      });

      const prompt = extractPrompt(input);
      const experimentalContext = spec.buildExperimentalContext
        ? await spec.buildExperimentalContext(input, context)
        : undefined;

      const result = await agent.stream({
        prompt,
        abortSignal,
        ...(experimentalContext !== undefined ? { experimental_context: experimentalContext } : {}),
      });

      let lastAssistantText = "";
      for await (const message of readUIMessageStream({
        stream: result.toUIMessageStream(),
      })) {
        const text = message.parts.findLast(isTextUIPart)?.text;
        if (text) lastAssistantText = text;
        yield message;
      }

      const [usage, steps] = await Promise.all([result.totalUsage, result.steps]);
      recordSubagentMetrics(tracker, spec, usage, steps as SubagentSteps);

      if (spec.postFinish) {
        for await (const message of spec.postFinish({
          input,
          agentContext: context,
          experimentalContext,
          lastAssistantText,
        })) {
          yield message;
        }
      }
    },
    toModelOutput: ({ output }) => {
      const message = output as UIMessage | undefined;
      const lastText = message?.parts.findLast(isTextUIPart);
      return {
        type: "text",
        value: lastText?.text ?? "Task completed.",
      };
    },
  });
}

/**
 * Pulls the primary text input out of the delegation tool's argument. Accepts
 * either the default `{ task }` shape or a custom shape whose first string
 * field is used as the prompt (as with the code domain's `{ repo, task }`).
 */
function extractPrompt(input: unknown): string {
  if (!input || typeof input !== "object") {
    throw new Error("Delegation tool received a non-object input");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.task === "string") return record.task;
  for (const value of Object.values(record)) {
    if (typeof value === "string") return value;
  }
  throw new Error("Delegation tool input has no string field to use as prompt");
}
