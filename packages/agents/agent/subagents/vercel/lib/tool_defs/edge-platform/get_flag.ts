import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_flag = defineTool({
  description: "Get a feature flag by id.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    flag_id: z.string(),
  }),
  execute: async ({ project_id_or_name, flag_id }) => {
    const result = await vercel().featureFlags.getFlag({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      flagIdOrSlug: flag_id,
    });
    return JSON.stringify(result);
  },
});
