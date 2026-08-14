import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { summarizePage } from "../../projections.ts";

export const get_deal = defineTool({
  description: `Retrieve a single Deal page by its Notion page ID.`,
  access: { risk: "read" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    deal_id: z.string().describe("Notion page UUID for the Deal row"),
  }),
  execute: async ({ deal_id }) => {
    const page = await notion.pages.retrieve({ page_id: deal_id });
    return summarizePage(page);
  },
});
