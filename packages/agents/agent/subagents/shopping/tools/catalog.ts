import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { SHOPPING_TOOLS } from "../lib/registry.ts";
import { SHOPPING_RUNTIME } from "../lib/runtime.ts";

const SHOPPING_TOOL_NAMES = Object.keys(SHOPPING_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await SHOPPING_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        SHOPPING_TOOL_NAMES,
      );
      return Object.fromEntries(
        visibleNames.map((toolName) => {
          const spec = SHOPPING_TOOLS[toolName];
          return [
            toolName,
            defineTool({
              description: spec.description,
              inputSchema: spec.input,
              approval: async (approvalCtx) =>
                await SHOPPING_RUNTIME.approvalForTool(toolName, approvalCtx),
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () => await SHOPPING_RUNTIME.executeTool(toolName, input, toolCtx),
                ),
            }),
          ];
        }),
      );
    },
  },
});
