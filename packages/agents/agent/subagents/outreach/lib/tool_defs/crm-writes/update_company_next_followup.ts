import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_company_next_followup = defineTool({
  description: `Set the Company "Next Follow-up" date property. Pass an ISO date string (YYYY-MM-DD) or null to clear it.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    company_id: z.string(),
    date: z.iso.date().nullable().describe("ISO date (YYYY-MM-DD) or null to clear"),
  }),
  execute: async ({ company_id, date }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      // oxlint-disable-next-line unicorn/no-null -- Notion clears a date property only when the request body sends an explicit null
      properties: { "Next Follow-up": date ? { date: { start: date } } : { date: null } },
    });
    return { id: page.id, next_followup: date };
  },
});
