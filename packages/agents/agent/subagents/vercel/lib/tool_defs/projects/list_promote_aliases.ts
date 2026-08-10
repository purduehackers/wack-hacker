import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_promote_aliases = defineTool({
  description:
    "List aliases from the most recent promote request. Use after `promote_deployment` to confirm traffic moved.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async ({ project_id_or_name, limit, since, until }) => {
    const result = await vercel().projects.listPromoteAliases({
      ...TEAM,
      projectId: project_id_or_name,
      limit,
      since,
      until,
    });
    return JSON.stringify(result);
  },
});
