import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_project_domain = defineTool({
  description: "Get a single project domain's details.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    // Not `z.hostname()`: project domains may be wildcards (`*.purduehackers.com`).
    domain: z.string().describe("Project domain name, may be a wildcard like *.example.com"),
  }),
  execute: async ({ project_id_or_name, domain }) => {
    const result = await vercel().projects.getProjectDomain({
      ...TEAM,
      idOrName: project_id_or_name,
      domain,
    });
    return JSON.stringify(result);
  },
});
