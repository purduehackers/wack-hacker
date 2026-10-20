import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/serialization.ts";
import { DISCORD_TOOLS } from "../lib/registry.ts";
import { DISCORD_RUNTIME } from "../lib/runtime.ts";

const DISCORD_TOOL_NAMES = Object.keys(DISCORD_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await DISCORD_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        DISCORD_TOOL_NAMES,
      );
      return Object.fromEntries(
        visibleNames.map((toolName) => {
          const spec = DISCORD_TOOLS[toolName];
          return [
            toolName,
            defineTool({
              description: spec.description,
              inputSchema: DISCORD_TOOLS[toolName].input,
              approval: {
                request: async (approvalCtx) =>
                  await DISCORD_RUNTIME.approvalForTool(toolName, approvalCtx),
                response: async (approvalCtx) =>
                  await DISCORD_RUNTIME.approvalResponseForTool(toolName, approvalCtx),
              },
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () => await DISCORD_RUNTIME.executeTool(toolName, input, toolCtx),
                ),
            }),
          ];
        }),
      );
    },
  },
});
