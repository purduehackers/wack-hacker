import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_aliases = defineTool({
  description:
    "List aliases for the active team. Filter by `domain`, `projectId`. Paginated via `limit`, `from`, `since`, `until`.",
  access: { risk: "read" },
  input: z.strictObject({
    // Not `z.hostname()`: aliases may be wildcards (`*.purduehackers.com`).
    domain: z.string().optional().describe("Filter to this alias domain; may be a wildcard"),
    from: epochMillis.optional(),
    limit: pageLimit.max(100).optional(),
    projectId: z.string().optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    rollbackDeploymentId: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().aliases.listAliases({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
