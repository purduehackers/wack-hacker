import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_team_invite_code = defineTool({
  description: "Delete a pending team invite code.",
  access: { risk: "destructive" },
  input: z.strictObject({ inviteId: z.string() }),
  execute: async ({ inviteId }) => {
    const result = await vercel().teams.deleteTeamInviteCode({
      ...TEAM,
      inviteId,
    });
    return JSON.stringify(result);
  },
});
