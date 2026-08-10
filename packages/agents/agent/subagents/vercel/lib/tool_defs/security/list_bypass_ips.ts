import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_bypass_ips = defineTool({
  description: "List IPs currently allowed to bypass firewall challenges.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
    sourceIp: z.string().optional(),
    // Not `z.hostname()`: a bypass is scoped to a project domain, and project
    // domains may be wildcards (`*.purduehackers.com`). The SDK documents this
    // only as "Filter by domain", so no format is guaranteed.
    domain: z.string().optional().describe("Filter to this domain; may be a wildcard"),
    projectScope: z.boolean().optional(),
    limit: pageLimit.optional(),
    offset: z.string().optional().describe("Pagination cursor id"),
  }),
  execute: async ({ project_id, ...query }) => {
    const result = await vercel().security.getBypassIp({
      ...TEAM,
      projectId: project_id,
      ...query,
    });
    return JSON.stringify(result);
  },
});
