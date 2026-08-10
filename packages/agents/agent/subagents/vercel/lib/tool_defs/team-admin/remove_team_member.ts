import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const remove_team_member = defineTool({
  description: "Remove a member from the active team.",
  access: { risk: "destructive" },
  input: z.strictObject({ uid: z.string(), newDefaultTeamId: z.string().optional() }),
  execute: async ({ uid, newDefaultTeamId }) => {
    const result = await vercel().teams.removeTeamMember({
      ...TEAM,
      uid,
      newDefaultTeamId,
    });
    return JSON.stringify(result);
  },
});
