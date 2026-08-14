import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { summarizePage } from "../../projections.ts";

export const get_company = defineTool({
  description: `Retrieve a single Company page by its Notion page ID. Returns every property including outreach tracking state.`,
  access: { risk: "read" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    company_id: z.string().describe("Notion page UUID for the Company row"),
  }),
  execute: async ({ company_id }) => {
    const page = await notion.pages.retrieve({ page_id: company_id });
    return summarizePage(page);
  },
});
