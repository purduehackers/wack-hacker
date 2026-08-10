import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { VERCEL_TEAM_ID } from "../../constants.ts";

export const get_team = defineTool({
  description: "Retrieve a team by id or slug.",
  access: { risk: "read" },
  input: z.strictObject({
    team_id_or_slug: z.string().optional().describe("Defaults to the active team"),
  }),
  execute: async ({ team_id_or_slug }) => {
    const id = team_id_or_slug ?? VERCEL_TEAM_ID;
    const result = await vercel().teams.getTeam({ teamId: id });
    return JSON.stringify(result);
  },
});
