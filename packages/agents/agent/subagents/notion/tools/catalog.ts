import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { NOTION_RUNTIME } from "../lib/runtime.ts";
import { NOTION_TOOLS } from "../lib/tool-registry.ts";

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
              inputSchema: spec.input,
              approval: async (approvalCtx) =>
                await NOTION_RUNTIME.approvalForTool(toolName, approvalCtx),
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
