import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const archive_contact = defineTool({
  description:
    "Archive (soft-delete) a Contact CRM row. The Notion page is marked archived and drops out of lists.",
  access: { risk: "destructive" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    contact_id: z.string().describe("Notion page UUID for the Contact row"),
  }),
  execute: async ({ contact_id }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      archived: true,
    });
    return { id: page.id, archived: true };
  },
});
