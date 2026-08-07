import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForLinearTool,
  executeLinearTool,
  visibleLinearToolNames,
} from "../lib/runtime.ts";
import { LINEAR_TOOLS } from "../lib/tool-registry.ts";

const LINEAR_TOOL_NAMES = Object.keys(LINEAR_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await visibleLinearToolNames(
        ctx.session.auth.current,
        LINEAR_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = LINEAR_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForLinearTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeLinearTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
