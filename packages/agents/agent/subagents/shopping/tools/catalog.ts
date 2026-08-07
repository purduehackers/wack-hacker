import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForShoppingTool,
  executeShoppingTool,
  visibleShoppingToolNames,
} from "../lib/runtime.ts";
import { SHOPPING_TOOLS } from "../lib/tool-registry.ts";

const SHOPPING_TOOL_NAMES = Object.keys(SHOPPING_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await visibleShoppingToolNames(
        ctx.session.auth.current,
        SHOPPING_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = SHOPPING_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForShoppingTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeShoppingTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
