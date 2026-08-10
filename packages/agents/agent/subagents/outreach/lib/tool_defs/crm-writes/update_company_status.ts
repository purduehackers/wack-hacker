import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_company_status = defineTool({
  description: `Set the Company Status property. Use an option that matches the data source schema (e.g. "Not Contacted", "Contacted", "Awaiting Response", "Donated"). Call retrieve_crm_schema first if unsure.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    company_id: z.string(),
    status: z.string().describe("Exact select option label from the Companies Status property"),
  }),
  execute: async ({ company_id, status }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { Status: { select: { name: status } } },
    });
    return { id: page.id, status };
  },
});
