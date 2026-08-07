import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { VERCEL_RUNTIME } from "../lib/runtime.ts";
import { VERCEL_TOOLS } from "../lib/tool-registry.ts";

const VERCEL_TOOL_NAMES = Object.keys(VERCEL_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await VERCEL_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        VERCEL_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = VERCEL_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) =>
            await VERCEL_RUNTIME.approvalForTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(
              async () => await VERCEL_RUNTIME.executeTool(toolName, input, toolCtx),
            ),
        });
      }
      return tools;
    },
  },
});
