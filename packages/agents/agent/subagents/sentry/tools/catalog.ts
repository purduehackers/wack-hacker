import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import { SENTRY_RUNTIME } from "../lib/runtime.ts";
import { SENTRY_TOOLS } from "../lib/tool-registry.ts";

const SENTRY_TOOL_NAMES = Object.keys(SENTRY_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await SENTRY_RUNTIME.visibleToolNames(
        ctx.session.auth.current,
        SENTRY_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = SENTRY_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) =>
            await SENTRY_RUNTIME.approvalForTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(
              async () => await SENTRY_RUNTIME.executeTool(toolName, input, toolCtx),
            ),
        });
      }
      return tools;
    },
  },
});
