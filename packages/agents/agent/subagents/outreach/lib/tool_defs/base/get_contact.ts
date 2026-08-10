import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { summarizePage } from "../../constants.ts";

export const get_contact = defineTool({
  description: `Retrieve a single Contact page by its Notion page ID. Returns every property including outreach tracking state.`,
  access: { risk: "read" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    contact_id: z.string().describe("Notion page UUID for the Contact row"),
  }),
  execute: async ({ contact_id }) => {
    const page = await notion.pages.retrieve({ page_id: contact_id });
    return summarizePage(page);
  },
});
