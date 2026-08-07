import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { OUTREACH_RUNTIME } from "../lib/runtime.ts";
import { OUTREACH_TOOLS } from "../lib/tool-registry.ts";

const OUTREACH_TOOL_NAMES = Object.keys(OUTREACH_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await OUTREACH_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        OUTREACH_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = OUTREACH_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) =>
            await OUTREACH_RUNTIME.approvalForTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(
              async () => await OUTREACH_RUNTIME.executeTool(toolName, input, toolCtx),
            ),
        });
      }
      return tools;
    },
  },
});
