import { badgeTools } from "@purduehackers/badges/tools";
import { defineDynamic, defineTool } from "eve/tools";

import { badgeRequest } from "../lib/client.ts";

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const { tools } = await badgeRequest(ctx.session.auth.current, "status");
      return Object.fromEntries(
        tools.map((name) => {
          const spec = badgeTools[name];
          return [
            name,
            defineTool({
              description: spec.description,
              inputSchema: spec.schema,
              execute: async (input, context) =>
                JSON.stringify(
                  await badgeRequest(context.session.auth.current, "tool", { name, input }),
                ),
            }),
          ];
        }),
      );
    },
  },
});
