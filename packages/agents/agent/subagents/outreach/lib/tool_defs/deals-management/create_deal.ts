import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { DEALS_DATA_SOURCE_ID, summarizePage } from "../../constants.ts";

export const create_deal = defineTool({
  description: `Create a new Deal row. "name" becomes the Deal title. Stage defaults to "Lead" when omitted. Call retrieve_crm_schema first to confirm Stage/Priority option labels.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    name: z.string().describe("Deal title"),
    amount: z.number().optional().describe("Dollar amount"),
    stage: z.string().optional().describe("Status option — defaults to Lead"),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    close_date: z.iso.date().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  }),
  execute: async ({ name, amount, stage, priority, close_date, notes }) => {
    const properties: CreatePageParameters["properties"] = {
      Deal: { title: [{ text: { content: name } }] },
      Stage: { status: { name: stage ?? "Lead" } },
    };
    if (amount !== undefined) properties.Amount = { number: amount };
    if (priority) properties.Priority = { select: { name: priority } };
    if (close_date) properties["Close date"] = { date: { start: close_date } };
    if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

    const params: CreatePageParameters = {
      parent: { type: "data_source_id", data_source_id: DEALS_DATA_SOURCE_ID },
      properties,
    };
    const page = await notion.pages.create(params);
    return summarizePage(page);
  },
});
