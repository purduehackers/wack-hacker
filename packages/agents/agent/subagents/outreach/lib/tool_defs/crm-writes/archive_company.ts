import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const archive_company = defineTool({
  description:
    "Archive (soft-delete) a Company CRM row. The Notion page is marked archived and drops out of lists but can be restored from the Notion UI.",
  access: { risk: "destructive" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    company_id: z.string().describe("Notion page UUID for the Company row"),
  }),
  execute: async ({ company_id }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      archived: true,
    });
    return { id: page.id, archived: true };
  },
});
