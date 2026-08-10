import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const list_contacts_in_audience = defineTool({
  description:
    "List contacts in a Resend segment (audience). Returns each contact's id, email, first/last name, and subscription state.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().contacts.list({ audienceId: audience_id });
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});
