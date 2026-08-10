import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit } from "../../constants.ts";

export const list_teams = defineTool({
  description:
    "List every Vercel team the authenticated account belongs to. Returns id, slug, name, createdAt. Paginated via `limit` / `since` / `until`.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional().describe("Unix ms timestamp lower bound"),
    until: epochMillis.optional().describe("Unix ms timestamp upper bound"),
  }),
  execute: async ({ limit, since, until }) => {
    const result = await vercel().teams.getTeams({ limit, since, until });
    return JSON.stringify(result);
  },
});
