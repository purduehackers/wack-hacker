import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_contact_status = defineTool({
  description: `Set the Contact Status property. Options: "New", "Nurturing", "Active", "Inactive". Call retrieve_crm_schema first if unsure.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    contact_id: z.string(),
    status: z.string().describe("Exact select option label"),
  }),
  execute: async ({ contact_id, status }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: { Status: { select: { name: status } } },
    });
    return { id: page.id, status };
  },
});
