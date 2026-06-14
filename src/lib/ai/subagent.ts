import {
  ToolLoopAgent,
  tool,
  stepCountIs,
  readUIMessageStream,
  isTextUIPart,
  type ModelMessage,
  type PrepareStepResult,
  type StepResult,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { textMessage } from "@/lib/ai/ui-message";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution } from "@/lib/metrics";

import type { AgentContext } from "./context.ts";
import type { HandoffEntity, SubagentSpec, TelemetryMetadata } from "./types.ts";

import { addCacheControl } from "./cache-control.ts";
import { SUBAGENT_MODEL, SUBAGENT_PREAMBLE, type UserRole } from "./constants.ts";
import { estimateModelCostUsd } from "./models-dev.ts";
import { applyPolicy, readBudgetState } from "./policy/index.ts";
import { SkillRegistry, createLoadSkillTool, computeActiveTools } from "./skills/index.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

export type { SubagentSpec } from "./types.ts";

const DEFAULT_TASK_INPUT_SCHEMA = z.object({
  task: z.string().describe("The task to delegate, forwarded verbatim"),
});

const DEFAULT_STOP_STEPS = 15;

/** Shape of the AI SDK `result.steps` output we consume for metrics + exhaustion detection. */
type SubagentSteps = { toolCalls: { toolName?: string }[]; finishReason?: string }[];

/**
 * Classify how a finished subagent run relates to its step cap.
 *
 * `exhausted` means `stepCountIs` cut the loop while the model was still
 * issuing tool calls — the run never produced a final answer and whatever
 * text exists is mid-task narration. `stepCountIs` only stops after a step
 * completes, so approval pauses below the cap don't false-positive. With the
 * forced wrap-up step (see `buildPrepareStep`) the last step usually finishes
 * with reason `stop`, so `hitStepCap` alone tracks cap pressure per domain.
 */
export function detectExhaustion(
  steps: SubagentSteps,
  stopSteps: number,
): { hitStepCap: boolean; exhausted: boolean } {
  const hitStepCap = steps.length >= stopSteps;
  return {
    hitStepCap,
    exhausted: hitStepCap && steps.at(-1)?.finishReason === "tool-calls",
  };
}

/**
 * Push subagent usage into the TurnUsageTracker and emit Sentry metrics.
 * Exported so we can unit-test the `?? 0` fallback for missing totalTokens
 * without driving a full mocked ToolLoopAgent.
 */
export function recordSubagentMetrics(
  tracker: TurnUsageTracker,
  spec: Pick<SubagentSpec, "name" | "model">,
  usage: { totalTokens?: number; inputTokens?: number; outputTokens?: number },
  steps: SubagentSteps,
  outcome?: { hitStepCap: boolean; exhausted: boolean },
): void {
  // Same resolution as createDelegationTool — the delegation ran on its own
  // model (the code domain's Opus override, else the shared mini).
  const model = spec.model ?? SUBAGENT_MODEL;
  const tokens = usage.totalTokens ?? 0;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const toolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const toolNames = steps.flatMap((s) =>
    s.toolCalls.flatMap((call) => (typeof call.toolName === "string" ? [call.toolName] : [])),
  );
  // Priced at the delegation's own model — domains differ by orders of
  // magnitude (the code domain runs Opus, others a mini). undefined until the
  // catalog warms or for an unpriced model; folded into the turn total.
  const costUsd = estimateModelCostUsd(model, { inputTokens, outputTokens });
  tracker.addSubagent({ tokens, toolCalls, toolNames, costUsd });
  if (outcome?.hitStepCap) {
    countMetric("ai.subagent.step_cap_hit", { domain: spec.name });
  }
  if (!outcome?.exhausted) {
    countMetric("ai.subagent.completed", { domain: spec.name });
  }
  const attrs = { domain: spec.name, model };
  recordDistribution("ai.subagent.tokens", tokens, attrs);
  recordDistribution("ai.subagent.tool_calls", toolCalls, attrs);
  if (costUsd !== undefined) {
    recordDistribution("ai.subagent.cost_usd", costUsd, attrs);
  }
  createWideLogger({
    op: "ai.subagent",
    subagent: { domain: spec.name, model },
  }).emit({
    outcome: outcome?.exhausted ? "exhausted" : "ok",
    hit_step_cap: outcome?.hitStepCap ?? false,
    tokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    tool_calls: toolCalls,
    tool_names: toolNames,
    steps: steps.length,
  });
}

/**
 * Build the `prepareStep` handler for a subagent's `ToolLoopAgent`. Combines
 * the active-tools update, Anthropic cache-control on messages, and the
 * forced wrap-up step: the step about to run is step index `steps.length`,
 * so at `stopSteps - 1` we set `toolChoice: "none"` to make the final step
 * under the cap produce the mandated Summary/Answer text instead of being
 * cut mid-tool-call. Exported so we can unit-test the branches.
 *
 * Note: per-step *tool* cache-control is not possible — `PrepareStepResult`
 * has no `tools` key. Tool cache-control is applied once at agent
 * construction in `createDelegationTool`; the explicit return type here makes
 * any future unsupported key a type error instead of a silent no-op.
 */
export function buildPrepareStep(args: {
  registry: SkillRegistry;
  role: UserRole;
  baseToolNames: string[];
  model: string;
  stopSteps: number;
}) {
  const { registry, role, baseToolNames, model, stopSteps } = args;
  return ({
    steps,
    messages,
  }: {
    steps: StepResult<ToolSet>[];
    messages: ModelMessage[];
  }): NonNullable<PrepareStepResult<ToolSet>> => {
    const active = computeActiveTools({ steps, registry, role, baseToolNames });
    return {
      ...(active ? { activeTools: active } : {}),
      ...(steps.length === stopSteps - 1 ? { toolChoice: "none" as const } : {}),
      messages: addCacheControl({ messages, model }),
    };
  };
}

/**
 * Assemble the nested `ToolLoopAgent` for one delegation call: preamble +
 * domain prompt + execution-context block, role-filtered approval-wrapped
 * tools (with Anthropic cache-control layered at construction — `prepareStep`
 * can't override tools, so this is where the SDK actually reads it), and the
 * step-cap/wrap-up plumbing.
 */
async function buildSubagentAgent(args: {
  spec: SubagentSpec;
  context: AgentContext;
  resolvedModel: string;
  stopSteps: number;
  extraMetadata?: TelemetryMetadata;
}) {
  const { spec, context, resolvedModel, stopSteps, extraMetadata } = args;
  const role = context.role;
  const registry = new SkillRegistry(spec.subSkills);
  const loadSkill = createLoadSkillTool(registry, role);
  const instructions = `${SUBAGENT_PREAMBLE}\n\n${spec.systemPrompt.replace(
    "{{SKILL_MENU}}",
    registry.buildSkillMenu(role),
  )}\n\n${context.subagentContextBlock()}`;

  const allTools: ToolSet = { ...spec.tools, loadSkill };
  const budget = await readBudgetState({ userId: context.userId, role });
  const tools = applyPolicy(allTools, {
    context,
    delegateName: spec.name,
    budget,
  });
  const baseToolNames = [...spec.baseToolNames, "loadSkill"];
  type ToolKey = keyof typeof tools;

  return new ToolLoopAgent({
    model: resolvedModel,
    instructions,
    tools: addCacheControl({ tools, model: resolvedModel }),
    stopWhen: stepCountIs(stopSteps),
    activeTools: baseToolNames as ToolKey[],
    prepareStep: buildPrepareStep({
      registry,
      role,
      baseToolNames,
      model: resolvedModel,
      stopSteps,
    }),
    providerOptions: { openai: { parallelToolCalls: true } },
    experimental_telemetry: {
      isEnabled: true,
      functionId: `subagent.${spec.name}`,
      // `model` lets AI Agents Insights filter gen_ai spans by the delegation's
      // actual model (the code domain runs Opus, others a mini); `subagent` is
      // the domain.
      metadata: { role, subagent: spec.name, model: resolvedModel, ...extraMetadata },
    },
  });
}

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
export function createDelegationTool(
  spec: SubagentSpec,
  context: AgentContext,
  tracker: TurnUsageTracker,
  extraMetadata?: TelemetryMetadata,
) {
  const inputSchema = spec.inputSchema ?? DEFAULT_TASK_INPUT_SCHEMA;
  const resolvedModel = spec.model ?? SUBAGENT_MODEL;
  const stopSteps = spec.stopSteps ?? DEFAULT_STOP_STEPS;

  return tool({
    description: spec.description,
    inputSchema,
    execute: async function* (input, { abortSignal }) {
      // Step count for the error wide event when the run dies mid-stream —
      // tracked from the accumulating UIMessage's step-start parts because
      // `result.steps` rejects (without a count) when the run crashes before
      // any step completes.
      let stepsObserved = 0;
      try {
        const agent = await buildSubagentAgent({
          spec,
          context,
          resolvedModel,
          stopSteps,
          extraMetadata,
        });
        const prompt = (spec.getPrompt ?? defaultGetPrompt)(input);
        const experimentalContext = spec.buildExperimentalContext
          ? await spec.buildExperimentalContext(input, context)
          : undefined;

        const result = await agent.stream({
          prompt,
          abortSignal,
          ...(experimentalContext !== undefined
            ? { experimental_context: experimentalContext }
            : {}),
        });

        // Once at least one step has completed, the SDK converts run errors
        // into stream `error` chunks instead of rejecting — the loop below
        // ends cleanly and `result.steps` resolves with the partial run. The
        // onError capture is the only signal that the run actually crashed.
        let streamError: unknown;
        let lastAssistantText = "";
        for await (const message of readUIMessageStream({
          stream: result.toUIMessageStream(),
          onError: (error) => {
            streamError = error;
          },
        })) {
          const text = message.parts.findLast(isTextUIPart)?.text;
          if (text) lastAssistantText = text;
          stepsObserved = message.parts.filter((p) => p.type === "step-start").length;
          yield message;
        }
        // The SDK normalizes thrown values to `Error` before delivering them
        // to onError, so this rethrows the original failure as-is.
        if (streamError !== undefined) throw streamError;

        const [usage, steps] = await Promise.all([result.totalUsage, result.steps]);
        stepsObserved = steps.length;
        const capOutcome = detectExhaustion(steps as SubagentSteps, stopSteps);
        recordSubagentMetrics(tracker, spec, usage, steps as SubagentSteps, capOutcome);

        if (spec.postFinish) {
          // postFinish owns the final yield (e.g. the PR-URL message) — it
          // receives the cap outcome and is responsible for labeling partial
          // work. Yielding the generic exhaustion message after it would
          // clobber that output (the tool result is the last yielded value).
          for await (const message of spec.postFinish({
            input,
            agentContext: context,
            experimentalContext,
            lastAssistantText,
            ...capOutcome,
          })) {
            yield message;
          }
        } else if (capOutcome.exhausted) {
          yield exhaustionMessage(steps.length, lastAssistantText);
        }
      } catch (error) {
        emitSubagentError(spec.name, resolvedModel, stepsObserved, error);
        throw error;
      }
    },
    toModelOutput: ({ output }) => {
      const message = output as UIMessage | undefined;
      const lastText = message?.parts.findLast(isTextUIPart)?.text;
      if (!lastText) {
        return { type: "text", value: "Subagent returned no final text." };
      }
      return { type: "text", value: appendEntitiesAppendix(lastText) };
    },
  });
}

/**
 * Default prompt extractor for the `{ task }` input schema. Specs with a
 * custom `inputSchema` are required (at the type level) to bring their own
 * `getPrompt`; the throw is the runtime backstop for untyped call sites.
 */
function defaultGetPrompt(input: unknown): string {
  const task = (input as { task?: unknown } | null | undefined)?.task;
  if (typeof task !== "string") {
    throw new Error(
      "Delegation tool input has no `task` string field — specs with a custom inputSchema must supply getPrompt",
    );
  }
  return task;
}

/**
 * Failure-path metrics + wide event for a delegation that crashed mid-run.
 * Per-domain error rate is the main tuning signal for a 12-domain system;
 * without this a crashed subagent left zero observable trace.
 */
function emitSubagentError(domain: string, model: string, steps: number, error: unknown): void {
  try {
    countMetric("ai.subagent.error", { domain, model });
    const logger = createWideLogger({ op: "ai.subagent", subagent: { domain } });
    logger.error(error as Error);
    logger.emit({ outcome: "error", steps });
  } catch {
    // Telemetry must never mask the original failure being rethrown.
  }
}

function exhaustionMessage(stepsUsed: number, lastAssistantText: string): UIMessage {
  const progress = lastAssistantText.trim();
  const text =
    `Subagent stopped after ${stepsUsed} steps without completing the task.` +
    (progress ? ` Last progress: ${progress}` : "");
  return textMessage(text, "subagent-exhaustion");
}

/** Cap on appendix entries so a link-heavy answer can't bloat the orchestrator context. */
const MAX_HANDOFF_ENTITIES = 10;

/**
 * Matches a fenced ```entities block at the end of the final text. The block
 * is the machine-readable handoff channel — the preamble bans raw UUIDs from
 * user-facing prose, so canonical IDs travel here instead.
 */
const ENTITIES_TRAILER_PATTERN = /\n*```entities[^\S\n]*\n([\s\S]*?)\n?```\s*$/;

/**
 * Split a subagent's final text into the user-facing answer and its handoff
 * entities. Prefers the fenced `entities` trailer; falls back to harvesting
 * markdown links from the prose so handoffs still work when the model skips
 * the trailer.
 */
export function extractEntitiesTrailer(text: string): {
  text: string;
  entities: HandoffEntity[];
} {
  const match = text.match(ENTITIES_TRAILER_PATTERN);
  if (!match) {
    return { text, entities: harvestMarkdownLinks(text) };
  }
  const entities = match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // Names may themselves contain pipes ("Hack Night | Week 3"); type/id/url
      // realistically can't, so extra fields fold back into the name.
      const fields = line.split("|").map((part) => part.trim());
      const [name, type, id, url] =
        fields.length > 4
          ? [fields.slice(0, fields.length - 3).join(" | "), ...fields.slice(-3)]
          : fields;
      if (!name) return [];
      return [{ name, type: type || undefined, id: id || undefined, url: url || undefined }];
    });
  return { text: text.slice(0, match.index).trimEnd(), entities };
}

function harvestMarkdownLinks(text: string): HandoffEntity[] {
  const entities: HandoffEntity[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    const url = match[2]!;
    if (seen.has(url)) continue;
    seen.add(url);
    entities.push({ name: match[1]!, url });
  }
  return entities;
}

/**
 * Strip the machine-readable trailer from the final text and append a
 * compact `Entities:` appendix so canonical IDs survive the handoff into the
 * orchestrator's context for follow-up delegations.
 */
export function appendEntitiesAppendix(finalText: string): string {
  const { text, entities } = extractEntitiesTrailer(finalText);
  if (entities.length === 0) return text;
  const rendered = entities.slice(0, MAX_HANDOFF_ENTITIES).map(formatEntity).join(", ");
  return `${text}\n\nEntities: ${rendered}`;
}

function formatEntity(entity: HandoffEntity): string {
  const label = entity.url ? `[${entity.name}](${entity.url})` : entity.name;
  const meta = [entity.type, entity.id].filter(
    (value): value is string => Boolean(value) && value !== entity.name,
  );
  return meta.length > 0 ? `${label} (${meta.join(" ")})` : label;
}
