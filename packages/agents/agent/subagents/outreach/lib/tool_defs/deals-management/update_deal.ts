import type { UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_deal = defineTool({
  description: `Update arbitrary Deal fields (amount, priority, close date, notes). Use update_deal_stage for Stage changes.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    deal_id: z.string(),
    amount: z.number().optional(),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    close_date: z.iso.date().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  }),
  execute: async ({ deal_id, amount, priority, close_date, notes }) => {
    const properties: UpdatePageParameters["properties"] = {};
    if (amount !== undefined) properties.Amount = { number: amount };
    if (priority) properties.Priority = { select: { name: priority } };
    if (close_date) properties["Close date"] = { date: { start: close_date } };
    if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

    const params: UpdatePageParameters = { page_id: deal_id, properties };
    const page = await notion.pages.update(params);
    return { id: page.id, updated: Object.keys(properties) };
  },
});
