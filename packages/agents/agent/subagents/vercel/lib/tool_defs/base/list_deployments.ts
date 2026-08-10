import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_deployments = defineTool({
  description:
    "List deployments for the active team. Optional filters: `projectId`, `target` (production/preview), `state` (comma-separated states like 'BUILDING,READY'), branch/commit, and time window. Paginate with `from`, `to`, `until`, `since`, and `limit`.",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string().optional(),
    app: z.string().optional().describe("Project name"),
    target: z.enum(["production", "preview"]).optional(),
    state: z.string().optional(),
    limit: pageLimit.max(100).optional(),
    from: epochMillis.optional().describe("Unix ms lower bound (cursor)"),
    to: epochMillis.optional().describe("Unix ms upper bound (cursor)"),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    users: z.string().optional().describe("Comma-separated creator user ids"),
    branch: z.string().optional(),
    sha: z.string().optional(),
    rollbackCandidate: z.boolean().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().deployments.getDeployments({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
