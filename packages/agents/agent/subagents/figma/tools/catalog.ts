import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { approvalForFigmaTool, executeFigmaTool, visibleFigmaToolNames } from "../lib/runtime.ts";
import { FIGMA_TOOLS } from "../lib/tool-registry.ts";

const FIGMA_TOOL_NAMES = Object.keys(FIGMA_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await visibleFigmaToolNames(ctx.session.auth.current, FIGMA_TOOL_NAMES);
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = FIGMA_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForFigmaTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeFigmaTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
