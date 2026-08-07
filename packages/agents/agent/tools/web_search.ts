import { defineDynamic, defineTool } from "eve/tools";

import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/core/runtime.ts";
import { guardToolExecution } from "../lib/core/serialization.ts";
import { searchWeb, webSearchInputSchema } from "../lib/core/web-search.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("web_search", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Search the web using Exa. Use for current events, external documentation, real-time info, or anything not in the Purdue Hackers knowledge base. Prefer 'neural' type for conceptual queries, 'keyword' for exact lookups.",
        inputSchema: webSearchInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("web_search", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await searchWeb(input);
            } catch (cause) {
              return coreToolFailure("Exa", cause);
            }
          });
        },
      });
    },
  },
});
