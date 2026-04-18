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

import type { SubagentSpec } from "./types.ts";

import { SUBAGENT_MODEL, SUBAGENT_PREAMBLE, UserRole } from "./constants.ts";
import {
  SkillRegistry,
  createLoadSkillTool,
  computeActiveTools,
  filterAdmin,
} from "./skills/index.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

export type { SubagentSpec } from "./types.ts";

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
  role: UserRole,
  tracker: TurnUsageTracker,
) {
  return tool({
    description: spec.description,
    inputSchema: z.object({
      task: z.string().describe("The task to delegate, forwarded verbatim"),
    }),
    execute: async function* ({ task }, { abortSignal }) {
      const registry = new SkillRegistry(spec.subSkills);
      const loadSkill = createLoadSkillTool(registry, role);
      const instructions = `${SUBAGENT_PREAMBLE}\n\n${spec.systemPrompt.replace(
        "{{SKILL_MENU}}",
        registry.buildSkillMenu(role),
      )}`;

      const allTools: ToolSet = { ...spec.tools, loadSkill };
      const tools = role === UserRole.Admin ? allTools : filterAdmin(allTools);

      const baseToolNames = [...spec.baseToolNames, "loadSkill"];
      type ToolKey = keyof typeof tools;

      const agent = new ToolLoopAgent({
        model: SUBAGENT_MODEL,
        instructions,
        tools,
        stopWhen: stepCountIs(15),
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

      const result = await agent.stream({ prompt: task, abortSignal });

      for await (const message of readUIMessageStream({
        stream: result.toUIMessageStream(),
      })) {
        yield message;
      }

      const [usage, steps] = await Promise.all([result.totalUsage, result.steps]);
      const tokens = usage.totalTokens ?? 0;
      const toolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
      tracker.addSubagent({ tokens, toolCalls });

      countMetric("ai.subagent.completed", { domain: spec.name });
      recordDistribution("ai.subagent.tokens", tokens, { domain: spec.name });
      recordDistribution("ai.subagent.tool_calls", toolCalls, { domain: spec.name });
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
