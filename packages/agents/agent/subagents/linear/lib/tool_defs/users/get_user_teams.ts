import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const get_user_teams = defineTool({
  description: "List the teams a user belongs to. Returns team ID, name, and key.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("User UUID"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    const teams = await u.teams();
    return JSON.stringify(teams.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key })));
  },
});
