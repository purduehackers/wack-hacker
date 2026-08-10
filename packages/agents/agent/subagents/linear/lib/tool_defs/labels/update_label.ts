import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { hexColor } from "../../constants.ts";

export const update_label = defineTool({
  description: "Update a label's name, color, or description.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string().describe("Label UUID"),
    name: z.string().exactOptional(),
    color: hexColor.exactOptional().describe("Hex color with leading #"),
    description: z.string().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateIssueLabel(id, input);
    const label = await payload.issueLabel;
    if (!label) return JSON.stringify({ error: "Failed to update label" });
    return JSON.stringify({ id: label.id, name: label.name, color: label.color });
  },
});
