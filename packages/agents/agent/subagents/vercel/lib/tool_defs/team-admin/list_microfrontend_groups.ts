import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_microfrontend_groups = defineTool({
  description: "List microfrontend groups on the team.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: z.string().optional(),
    since: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().microfrontends.getMicrofrontendsGroups({
      ...TEAM,
      ...input,
    });
    return JSON.stringify(result);
  },
});
