import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_project_members = defineTool({
  description: "List members with access to a specific project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    search: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, limit, since, until, search }) => {
    const result = await vercel().projectMembers.getProjectMembers({
      ...TEAM,
      idOrName: project_id_or_name,
      limit,
      since,
      until,
      search,
    });
    return JSON.stringify(result);
  },
});
