import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { approvalForCmsTool, executeCmsTool, visibleCmsToolNames } from "../lib/runtime.ts";
import { CMS_TOOLS } from "../lib/tool-registry.ts";

const CMS_TOOL_NAMES = Object.keys(CMS_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await visibleCmsToolNames(ctx.session.auth.current, CMS_TOOL_NAMES);
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = CMS_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForCmsTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeCmsTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
