import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_deal_stage = defineTool({
  description: `Update a Deal's Stage. Use the exact status option label (e.g. "Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"). Stage transitions are manual — do not auto-advance.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    deal_id: z.string(),
    stage: z.string().describe("Exact Stage status option label"),
  }),
  execute: async ({ deal_id, stage }) => {
    const page = await notion.pages.update({
      page_id: deal_id,
      properties: { Stage: { status: { name: stage } } },
    });
    return { id: page.id, stage };
  },
});
