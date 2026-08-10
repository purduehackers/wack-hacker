import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_team_flag_settings = defineTool({
  description: "List feature-flag settings across every project on the team.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().featureFlags.listTeamFlagSettings({ ...TEAM });
    return JSON.stringify(result);
  },
});
