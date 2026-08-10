import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_project_check = defineTool({
  description: "Get a deployment check by id.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    check_id: z.string(),
  }),
  execute: async ({ project_id_or_name, check_id }) => {
    const result = await vercel().checksV2.getProjectCheck({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      checkId: check_id,
    });
    return JSON.stringify(result);
  },
});
