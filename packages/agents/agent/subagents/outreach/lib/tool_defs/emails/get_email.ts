import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const get_email = defineTool({
  description:
    "Retrieve a Resend email by ID. Returns current delivery status (sent, delivered, bounced, complained, opened, clicked), subject, from, to, and timestamps.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    email_id: z.string().describe("Resend email ID"),
  }),
  execute: async ({ email_id }) => {
    const result = await resend().emails.get(email_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
