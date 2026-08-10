import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_access_groups = defineTool({
  description: "List access groups on the team.",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string().optional(),
    search: z.string().optional(),
    membersLimit: pageLimit.optional(),
    projectsLimit: pageLimit.optional(),
    limit: pageLimit.optional(),
    next: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().accessGroups.listAccessGroups({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
