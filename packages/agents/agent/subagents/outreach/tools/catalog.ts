import { serializeError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForOutreachTool,
  executeOutreachTool,
  visibleOutreachToolNames,
} from "../lib/runtime.ts";
import {
  availableOutreachSkills,
  loadOutreachSkill,
  progressiveOutreachToolNames,
} from "../lib/skills.ts";
import { OUTREACH_TOOLS } from "../lib/tool-registry.ts";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const availableSkills = availableOutreachSkills(ctx.session.auth.current);
      const requestedNames = progressiveOutreachToolNames(ctx.messages);
      const visibleNames = await visibleOutreachToolNames(ctx.session.auth.current, requestedNames);
      const tools: Record<string, unknown> = {
        load_skill: defineTool({
          description:
            "Load a Outreach skill before using its specialized tools. Available: " +
            availableSkills.map((skill) => `${skill.name} — ${skill.description}`).join("; "),
          inputSchema: z.object({ name: z.string().min(1) }),
          execute: async (input, toolCtx) => {
            return guardToolExecution(async () => {
              const loaded = loadOutreachSkill(input.name, toolCtx.session.auth.current);
              if (loaded.status === "error") {
                return { ok: false, error: serializeError(loaded.error) };
              }
              return {
                ok: true,
                activation: `outreach.skill.loaded:${loaded.value.name}`,
                name: loaded.value.name,
                description: loaded.value.description,
                criteria: loaded.value.criteria,
                instructions: loaded.value.instructions,
                tools: loaded.value.toolNames,
              };
            });
          },
        }),
      };
      for (const toolName of visibleNames) {
        const spec = OUTREACH_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForOutreachTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeOutreachTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
    "step.started": async (_event, ctx) => {
      const availableSkills = availableOutreachSkills(ctx.session.auth.current);
      const requestedNames = progressiveOutreachToolNames(ctx.messages);
      const visibleNames = await visibleOutreachToolNames(ctx.session.auth.current, requestedNames);
      const tools: Record<string, unknown> = {
        load_skill: defineTool({
          description:
            "Load a Outreach skill before using its specialized tools. Available: " +
            availableSkills.map((skill) => `${skill.name} — ${skill.description}`).join("; "),
          inputSchema: z.object({ name: z.string().min(1) }),
          execute: async (input, toolCtx) => {
            return guardToolExecution(async () => {
              const loaded = loadOutreachSkill(input.name, toolCtx.session.auth.current);
              if (loaded.status === "error") {
                return { ok: false, error: serializeError(loaded.error) };
              }
              return {
                ok: true,
                activation: `outreach.skill.loaded:${loaded.value.name}`,
                name: loaded.value.name,
                description: loaded.value.description,
                criteria: loaded.value.criteria,
                instructions: loaded.value.instructions,
                tools: loaded.value.toolNames,
              };
            });
          },
        }),
      };
      for (const toolName of visibleNames) {
        const spec = OUTREACH_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForOutreachTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeOutreachTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
