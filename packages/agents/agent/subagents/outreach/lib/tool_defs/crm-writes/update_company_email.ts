import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_company_email = defineTool({
  description: `Set the Company Email property. Use after verifying an address via verify_email.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    company_id: z.string(),
    email: z.email(),
  }),
  execute: async ({ company_id, email }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { Email: { email } },
    });
    return { id: page.id, email };
  },
});
