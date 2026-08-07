import { serializeError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForDiscordTool,
  executeDiscordTool,
  visibleDiscordToolNames,
} from "../lib/runtime.ts";
import {
  availableDiscordSkills,
  loadDiscordSkill,
  progressiveDiscordToolNames,
} from "../lib/skills.ts";
import { DISCORD_TOOLS } from "../lib/tool-registry.ts";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const availableSkills = availableDiscordSkills(ctx.session.auth.current);
      const requestedNames = progressiveDiscordToolNames(ctx.messages);
      const visibleNames = await visibleDiscordToolNames(ctx.session.auth.current, requestedNames);
      const tools: Record<string, unknown> = {
        load_skill: defineTool({
          description:
            "Load a Discord skill before using its specialized tools. Available: " +
            availableSkills.map((skill) => `${skill.name} — ${skill.description}`).join("; "),
          inputSchema: z.strictObject({ name: z.string().min(1) }),
          execute: async (input, toolCtx) => {
            return guardToolExecution(async () => {
              const loaded = loadDiscordSkill(input.name, toolCtx.session.auth.current);
              if (loaded.status === "error")
                return { ok: false, error: serializeError(loaded.error) };
              return {
                ok: true,
                activation: `discord.skill.loaded:${loaded.value.name}`,
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
        const spec = DISCORD_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForDiscordTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeDiscordTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
    "step.started": async (_event, ctx) => {
      const availableSkills = availableDiscordSkills(ctx.session.auth.current);
      const requestedNames = progressiveDiscordToolNames(ctx.messages);
      const visibleNames = await visibleDiscordToolNames(ctx.session.auth.current, requestedNames);
      const tools: Record<string, unknown> = {
        load_skill: defineTool({
          description:
            "Load a Discord skill before using its specialized tools. Available: " +
            availableSkills.map((skill) => `${skill.name} — ${skill.description}`).join("; "),
          inputSchema: z.strictObject({ name: z.string().min(1) }),
          execute: async (input, toolCtx) => {
            return guardToolExecution(async () => {
              const loaded = loadDiscordSkill(input.name, toolCtx.session.auth.current);
              if (loaded.status === "error")
                return { ok: false, error: serializeError(loaded.error) };
              return {
                ok: true,
                activation: `discord.skill.loaded:${loaded.value.name}`,
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
        const spec = DISCORD_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForDiscordTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeDiscordTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
