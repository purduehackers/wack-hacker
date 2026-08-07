import { defineDynamic, defineTool } from "eve/tools";

import { guardToolExecution } from "../../../lib/core/serialization.ts";
import {
  approvalForFinanceTool,
  executeFinanceTool,
  visibleFinanceToolNames,
} from "../lib/runtime.ts";
import { FINANCE_TOOLS } from "../lib/tool-registry.ts";

const FINANCE_TOOL_NAMES = Object.keys(FINANCE_TOOLS);

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const visibleNames = await visibleFinanceToolNames(
        ctx.session.auth.current,
        FINANCE_TOOL_NAMES,
      );
      const tools: Record<string, unknown> = {};
      for (const toolName of visibleNames) {
        const spec = FINANCE_TOOLS[toolName];
        tools[toolName] = defineTool({
          description: spec.description,
          inputSchema: spec.input,
          approval: async (approvalCtx) => await approvalForFinanceTool(toolName, approvalCtx),
          execute: async (input, toolCtx) =>
            guardToolExecution(async () => await executeFinanceTool(toolName, input, toolCtx)),
        });
      }
      return tools;
    },
  },
});
