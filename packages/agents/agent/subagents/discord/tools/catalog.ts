import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForDiscordTool,
  executeDiscordTool,
  visibleDiscordToolNames,
} from "../lib/runtime.ts";
import { DISCORD_TOOLS } from "../lib/tool-registry.ts";

const DISCORD_TOOL_NAMES = Object.keys(DISCORD_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await visibleDiscordToolNames(
        ctx.session.auth.current,
        DISCORD_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
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
