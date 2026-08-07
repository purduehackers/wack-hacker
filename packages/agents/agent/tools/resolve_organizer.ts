import { defineDynamic, defineTool } from "eve/tools";

import { resolveOrganizer, resolveOrganizerInputSchema } from "../lib/core/organizers.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/core/runtime.ts";
import { guardToolExecution } from "../lib/core/serialization.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("resolve_organizer", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Resolve a Purdue Hackers organizer by name or alias to their authoritative platform user IDs (Discord, Linear, Notion, Sentry, GitHub, Figma). Call this before any platform-specific user search whenever the user refers to someone by name. Returns found:false if no organizer matches.",
        inputSchema: resolveOrganizerInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("resolve_organizer", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await resolveOrganizer(input);
            } catch (cause) {
              return coreToolFailure("Edge Config", cause);
            }
          });
        },
      });
    },
  },
});
