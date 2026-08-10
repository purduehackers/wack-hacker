import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const add_contact_to_audience = defineTool({
  description: "Add a contact to a Resend segment (audience) by email. Creates the contact if new.",
  access: { risk: "write" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
    email: z.email().describe("Contact email"),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    unsubscribed: z.boolean().optional().describe("Mark as unsubscribed"),
  }),
  execute: async ({ audience_id, email, first_name, last_name, unsubscribed }) => {
    const result = await resend().contacts.create({
      audienceId: audience_id,
      email,
      ...(first_name === undefined ? {} : { firstName: first_name }),
      ...(last_name === undefined ? {} : { lastName: last_name }),
      ...(unsubscribed === undefined ? {} : { unsubscribed }),
    });
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
