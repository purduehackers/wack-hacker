import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_projects = defineTool({
  description:
    "List Vercel projects in the active team. Supports `search`, `from` (timestamp cursor), `limit`, and repo filters.",
  access: { risk: "read" },
  input: z.strictObject({
    search: z.string().optional(),
    limit: pageLimit.max(100).optional(),
    from: epochMillis.optional().describe("Unix ms timestamp for pagination cursor"),
    repoUrl: z.url().optional().describe("Filter to projects linked to this git repository URL"),
    gitForkProtection: z.enum(["0", "1"]).optional(),
  }),
  execute: async ({ search, limit, from, repoUrl, gitForkProtection }) => {
    const result = await vercel().projects.getProjects({
      ...TEAM,
      search,
      limit: limit !== undefined ? String(limit) : undefined,
      from: from !== undefined ? String(from) : undefined,
      repoUrl,
      gitForkProtection,
    });
    return JSON.stringify(result);
  },
});
