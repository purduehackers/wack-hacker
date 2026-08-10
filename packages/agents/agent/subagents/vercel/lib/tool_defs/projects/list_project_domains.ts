import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_project_domains = defineTool({
  description:
    "List domains attached to a project. Returns name, git branch binding, redirect, verification state.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    production: z.enum(["true", "false"]).optional(),
    target: z.enum(["production", "preview"]).optional(),
    customEnvironmentId: z.string().optional(),
    gitBranch: z.string().optional(),
    redirects: z.enum(["true", "false"]).optional(),
    redirect: z.string().optional(),
    verified: z.enum(["true", "false"]).optional(),
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  }),
  execute: async ({ project_id_or_name, ...query }) => {
    const result = await vercel().projects.getProjectDomains({
      ...TEAM,
      idOrName: project_id_or_name,
      ...query,
    });
    return JSON.stringify(result);
  },
});
