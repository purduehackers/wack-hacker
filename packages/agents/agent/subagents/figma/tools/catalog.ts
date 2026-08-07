import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { FIGMA_RUNTIME } from "../lib/runtime.ts";
import { FIGMA_TOOLS } from "../lib/tool-registry.ts";

const FIGMA_TOOL_NAMES = Object.keys(FIGMA_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await FIGMA_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        FIGMA_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = FIGMA_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) =>
            await FIGMA_RUNTIME.approvalForTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(
              async () => await FIGMA_RUNTIME.executeTool(toolName, input, toolCtx),
            ),
        });
      }
      return tools;
    },
  },
});
