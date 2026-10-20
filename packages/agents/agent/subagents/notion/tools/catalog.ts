import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/serialization.ts";
import { NOTION_TOOLS } from "../lib/registry.ts";
import { NOTION_RUNTIME } from "../lib/runtime.ts";

const NOTION_TOOL_NAMES = Object.keys(NOTION_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await NOTION_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        NOTION_TOOL_NAMES,
      );
      return Object.fromEntries(
        visibleNames.map((toolName) => {
          const spec = NOTION_TOOLS[toolName];
          return [
            toolName,
            defineTool({
              description: spec.description,
              inputSchema: NOTION_TOOLS[toolName].input,
              approval: {
                request: async (approvalCtx) =>
                  await NOTION_RUNTIME.approvalForTool(toolName, approvalCtx),
                response: async (approvalCtx) =>
                  await NOTION_RUNTIME.approvalResponseForTool(toolName, approvalCtx),
              },
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () => await NOTION_RUNTIME.executeTool(toolName, input, toolCtx),
                ),
            }),
          ];
        }),
      );
    },
  },
});
