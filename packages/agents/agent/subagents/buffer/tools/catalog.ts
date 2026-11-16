import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/serialization.ts";
import { BUFFER_TOOLS } from "../lib/registry.ts";
import { BUFFER_RUNTIME } from "../lib/runtime.ts";

const BUFFER_TOOL_NAMES = Object.keys(BUFFER_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await BUFFER_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        BUFFER_TOOL_NAMES,
      );
      return Object.fromEntries(
        visibleNames.map((toolName) => {
          const spec = BUFFER_TOOLS[toolName];
          return [
            toolName,
            defineTool({
              description: spec.description,
              inputSchema: spec.input,
              approval: async (approvalCtx) =>
                await BUFFER_RUNTIME.approvalForTool(toolName, approvalCtx),
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () => await BUFFER_RUNTIME.executeTool(toolName, input, toolCtx),
                ),
            }),
          ];
        }),
      );
    },
  },
});
