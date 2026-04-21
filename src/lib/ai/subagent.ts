import {
  ToolLoopAgent,
  tool,
  stepCountIs,
  readUIMessageStream,
  isTextUIPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { countMetric, recordDistribution } from "@/lib/metrics";

import type { AgentContext } from "./context.ts";
import type { SubagentSpec } from "./types.ts";

import { wrapApprovalTools } from "./approvals/index.ts";
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

      const agent = new ToolLoopAgent({
        model: spec.model ?? SUBAGENT_MODEL,
        instructions,
        tools,
        stopWhen: stepCountIs(spec.stopSteps ?? 15),
        activeTools: baseToolNames as ToolKey[],
        prepareStep: ({ steps }) => {
          const active = computeActiveTools({ steps, registry, role, baseToolNames });
          return active ? { activeTools: active as ToolKey[] } : undefined;
        },
        providerOptions: {
          openai: {
            parallelToolCalls: true,
          },
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: `subagent.${spec.name}`,
          metadata: {
            role,
            subagent: spec.name,
          },
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
      const tokens = usage.totalTokens ?? 0;
      const toolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
      tracker.addSubagent({ tokens, toolCalls });

      countMetric("ai.subagent.completed", { domain: spec.name });
      recordDistribution("ai.subagent.tokens", tokens, { domain: spec.name });
      recordDistribution("ai.subagent.tool_calls", toolCalls, { domain: spec.name });

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
