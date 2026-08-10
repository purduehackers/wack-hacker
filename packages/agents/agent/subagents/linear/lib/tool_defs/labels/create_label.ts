import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { hexColor } from "../../constants.ts";

export const create_label = defineTool({
  description:
    "Create a new issue label. Scope to a team by passing team_id, otherwise creates a workspace-wide label.",
  access: { risk: "write" },
  input: z.strictObject({
    name: z.string().describe("Label name"),
    color: hexColor.exactOptional().describe("Hex color with leading # (e.g. '#FF0000')"),
    description: z.string().exactOptional(),
    team_id: z.string().exactOptional().describe("Team UUID to scope the label to"),
  }),
  execute: async ({ team_id, ...rest }) => {
    const payload = await linear.createIssueLabel({
      ...rest,
      ...(team_id === undefined ? {} : { teamId: team_id }),
    });
    const label = await payload.issueLabel;
    if (!label) return JSON.stringify({ error: "Failed to create label" });
    return JSON.stringify({ id: label.id, name: label.name, color: label.color });
  },
});
