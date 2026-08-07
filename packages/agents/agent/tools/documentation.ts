import { defineDynamic, defineTool } from "eve/tools";

import { documentationInputSchema, queryDocumentation } from "../lib/core/documentation.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/core/runtime.ts";
import { guardToolExecution } from "../lib/core/serialization.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("documentation", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Ask a question about Purdue Hackers — events, projects, documentation, history, culture, and organizational info.",
        inputSchema: documentationInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("documentation", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await queryDocumentation(input);
            } catch (cause) {
              return coreToolFailure("Purdue Hackers knowledge base", cause);
            }
          });
        },
      });
    },
  },
});
