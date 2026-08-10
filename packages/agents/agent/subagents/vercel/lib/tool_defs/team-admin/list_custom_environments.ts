import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_custom_environments = defineTool({
  description:
    "List custom preview environments for a project. Custom environments support per-branch URL schemes, custom domains, and environment-specific variables.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    gitBranch: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, gitBranch }) => {
    const result = await vercel().environment.getProjectsByIdOrNameCustomEnvironments({
      ...TEAM,
      idOrName: project_id_or_name,
      gitBranch,
    });
    return JSON.stringify(result);
  },
});
