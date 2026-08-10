import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_project_checks = defineTool({
  description: "List deployment checks configured on a project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    blocks: z
      .enum(["build-start", "deployment-start", "deployment-alias", "deployment-promotion", "none"])
      .optional(),
  }),
  execute: async ({ project_id_or_name, blocks }) => {
    const result = await vercel().checksV2.listProjectChecks({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      blocks,
    });
    return JSON.stringify(result);
  },
});
