import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { NO_TEAM } from "../../constants.ts";

export const get_label = defineTool({
  description: "Get details for a single label by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: z.string().describe("Label UUID") }),
  execute: async ({ id }) => {
    const l = await linear.issueLabel(id);
    const team = l.team ? await l.team : undefined;
    return JSON.stringify({
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description,
      team: team ? { id: team.id, name: team.name } : NO_TEAM,
    });
  },
});
