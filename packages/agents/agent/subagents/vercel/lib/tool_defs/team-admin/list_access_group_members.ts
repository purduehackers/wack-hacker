import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_access_group_members = defineTool({
  description: "List members of an access group.",
  access: { risk: "read" },
  input: z.strictObject({
    access_group_id_or_name: z.string(),
    limit: pageLimit.optional(),
    next: z.string().optional(),
  }),
  execute: async ({ access_group_id_or_name, limit, next }) => {
    const result = await vercel().accessGroups.listAccessGroupMembers({
      ...TEAM,
      idOrName: access_group_id_or_name,
      limit,
      next,
    });
    return JSON.stringify(result);
  },
});
