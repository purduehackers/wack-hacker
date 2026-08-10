import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { CLOUDFLARE_RUNTIME } from "../lib/runtime.ts";
import { CLOUDFLARE_TOOLS } from "../lib/tool-registry.ts";

const CLOUDFLARE_TOOL_NAMES = Object.keys(CLOUDFLARE_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await CLOUDFLARE_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        CLOUDFLARE_TOOL_NAMES,
      );
      return Object.fromEntries(
        visibleNames.map((toolName) => {
          const spec = CLOUDFLARE_TOOLS[toolName];
          return [
            toolName,
            defineTool({
              description: spec.description,
              inputSchema: spec.input,
              approval: async (approvalCtx) =>
                await CLOUDFLARE_RUNTIME.approvalForTool(toolName, approvalCtx),
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () => await CLOUDFLARE_RUNTIME.executeTool(toolName, input, toolCtx),
                ),
            }),
          ];
        }),
      );
    },
  },
});
