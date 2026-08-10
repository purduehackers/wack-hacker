import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_team_flags = defineTool({
  description: "List every feature flag across the team's projects.",
  access: { risk: "read" },
  input: z.strictObject({ limit: pageLimit.optional() }),
  execute: async ({ limit }) => {
    const result = await vercel().featureFlags.listTeamFlags({ ...TEAM, limit });
    return JSON.stringify(result);
  },
});
