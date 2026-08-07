import { serializeError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForVercelTool,
  executeVercelTool,
  visibleVercelToolNames,
} from "../lib/runtime.ts";
import {
  availableVercelSkills,
  loadVercelSkill,
  progressiveVercelToolNames,
} from "../lib/skills.ts";
import { VERCEL_TOOLS } from "../lib/tool-registry.ts";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const availableSkills = availableVercelSkills(ctx.session.auth.current);
      const requestedNames = progressiveVercelToolNames(ctx.messages);
      const visibleNames = await visibleVercelToolNames(ctx.session.auth.current, requestedNames);
      const tools: Record<string, unknown> = {
        load_skill: defineTool({
          description:
            "Load a Vercel skill before using its specialized tools. Available: " +
            availableSkills.map((skill) => `${skill.name} — ${skill.description}`).join("; "),
          inputSchema: z.object({ name: z.string().min(1) }),
          execute: async ({ name }, toolCtx) => {
            return guardToolExecution(async () => {
              const loaded = loadVercelSkill(name, toolCtx.session.auth.current);
              if (loaded.status === "error") {
                return { ok: false, error: serializeError(loaded.error) };
              }
              return {
                ok: true,
                activation: `vercel.skill.loaded:${loaded.value.name}`,
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
        const spec = VERCEL_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForVercelTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeVercelTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
    "step.started": async (_event, ctx) => {
      const availableSkills = availableVercelSkills(ctx.session.auth.current);
      const requestedNames = progressiveVercelToolNames(ctx.messages);
      const visibleNames = await visibleVercelToolNames(ctx.session.auth.current, requestedNames);
      const tools: Record<string, unknown> = {
        load_skill: defineTool({
          description:
            "Load a Vercel skill before using its specialized tools. Available: " +
            availableSkills.map((skill) => `${skill.name} — ${skill.description}`).join("; "),
          inputSchema: z.object({ name: z.string().min(1) }),
          execute: async ({ name }, toolCtx) => {
            return guardToolExecution(async () => {
              const loaded = loadVercelSkill(name, toolCtx.session.auth.current);
              if (loaded.status === "error") {
                return { ok: false, error: serializeError(loaded.error) };
              }
              return {
                ok: true,
                activation: `vercel.skill.loaded:${loaded.value.name}`,
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
        const spec = VERCEL_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForVercelTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeVercelTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
