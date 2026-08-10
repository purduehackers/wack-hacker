import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_flag_versions = defineTool({
  description: "List historical versions of a feature flag.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    flag_id: z.string(),
    limit: pageLimit.optional(),
  }),
  execute: async ({ project_id_or_name, flag_id, limit }) => {
    const result = await vercel().featureFlags.listFlagVersions({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      flagIdOrSlug: flag_id,
      limit,
    });
    return JSON.stringify(result);
  },
});
