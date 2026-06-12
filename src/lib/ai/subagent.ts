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
import type { SubagentSpec, TelemetryMetadata, UsageLike } from "./types.ts";

import { wrapApprovalTools } from "./approvals/index.ts";
import { addCacheControl } from "./cache-control.ts";
import { SUBAGENT_MODEL, SUBAGENT_PREAMBLE, UserRole } from "./constants.ts";
import { estimateCostUsd } from "./pricing.ts";
import {
  SkillRegistry,
  createLoadSkillTool,
  computeActiveTools,
  filterAdmin,
} from "./skills/index.ts";
import { TurnUsageTracker, extractCachedInputTokens } from "./turn-usage.ts";

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
 * Takes the resolved model slug + the full AI SDK usage object so the
 * distributions carry `{domain, model}` attributes and input/output/cached
 * splits — `cachedInputTokens` here is the verification metric for prompt
 * caching, and the splits feed per-model cost attribution at turn end.
 * Exported so we can unit-test the `?? 0` fallbacks without driving a full
 * mocked ToolLoopAgent.
 */
export function recordSubagentMetrics(
  tracker: TurnUsageTracker,
  spec: Pick<SubagentSpec, "name">,
  model: string,
  usage: UsageLike,
  steps: SubagentSteps,
): void {
  const tokens = usage.totalTokens ?? 0;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cachedInputTokens = extractCachedInputTokens(usage);
  const toolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const toolNames = steps.flatMap((s) =>
    s.toolCalls.flatMap((call) => (typeof call.toolName === "string" ? [call.toolName] : [])),
  );
  tracker.addSubagent({
    domain: spec.name,
    model,
    tokens,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    toolCalls,
    toolNames,
  });
  const attrs = { domain: spec.name, model };
  countMetric("ai.subagent.completed", attrs);
  recordDistribution("ai.subagent.tokens", tokens, attrs);
  recordDistribution("ai.subagent.input_tokens", inputTokens, attrs);
  recordDistribution("ai.subagent.output_tokens", outputTokens, attrs);
  recordDistribution("ai.subagent.cached_input_tokens", cachedInputTokens, attrs);
  recordDistribution("ai.subagent.tool_calls", toolCalls, attrs);
  const costUsd = estimateCostUsd({ model, inputTokens, outputTokens, cachedInputTokens });
  if (costUsd === undefined) {
    countMetric("ai.cost.unknown_model", { model, domain: spec.name });
  } else {
    recordDistribution("ai.subagent.cost_usd", costUsd, attrs);
  }
  createWideLogger({
    op: "ai.subagent",
    subagent: { domain: spec.name, model },
  }).emit({
    outcome: "ok",
    tokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
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
      recordSubagentMetrics(tracker, spec, resolvedModel, usage, steps as SubagentSteps);

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
