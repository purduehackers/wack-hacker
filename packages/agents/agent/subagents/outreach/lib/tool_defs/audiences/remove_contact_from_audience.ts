import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const remove_contact_from_audience = defineTool({
  description:
    "Remove a contact from a Resend segment (audience). Provide either contact_id or email.",
  access: { risk: "destructive" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
    contact_id: z.string().optional().describe("Contact ID (preferred)"),
    email: z.email().optional().describe("Contact email (used if contact_id omitted)"),
  }),
  execute: async ({ audience_id, contact_id, email }) => {
    const result = contact_id
      ? await resend().contacts.remove({ audienceId: audience_id, id: contact_id })
      : email
        ? await resend().contacts.remove({ audienceId: audience_id, email })
        : undefined;
    if (result === undefined) return { error: "Provide contact_id or email" };
    if (result.error) return { error: result.error.message };
    return { removed: true, audience_id, contact_id, email };
  },
});
