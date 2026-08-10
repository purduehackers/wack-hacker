import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { GITHUB_TOOLS } from "../lib/registry.ts";
import { GITHUB_RUNTIME } from "../lib/runtime.ts";

const GITHUB_TOOL_NAMES = Object.keys(GITHUB_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await GITHUB_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        GITHUB_TOOL_NAMES,
      );
      return Object.fromEntries(
        visibleNames.map((toolName) => {
          const spec = GITHUB_TOOLS[toolName];
          return [
            toolName,
            defineTool({
              description: spec.description,
              inputSchema: spec.input,
              approval: async (approvalCtx) =>
                await GITHUB_RUNTIME.approvalForTool(toolName, approvalCtx),
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () => await GITHUB_RUNTIME.executeTool(toolName, input, toolCtx),
                ),
            }),
          ];
        }),
      );
    },
  },
});
