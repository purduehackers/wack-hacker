import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_contact_email = defineTool({
  description: `Set the Contact Email property. Use after verifying the address via verify_email.`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    contact_id: z.string(),
    email: z.email(),
  }),
  execute: async ({ contact_id, email }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: { Email: { email } },
    });
    return { id: page.id, email };
  },
});
