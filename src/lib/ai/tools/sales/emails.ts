import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { resend } from "./client.ts";

export const get_email = tool({
  description:
    "Retrieve a Resend email by ID. Returns current delivery status (sent, delivered, bounced, complained, opened, clicked), subject, from, to, and timestamps.",
  inputSchema: z.object({
    email_id: z.string().describe("Resend email ID"),
  }),
  execute: async ({ email_id }) => {
    const result = await resend().emails.get(email_id);
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const cancel_email = approval(
  tool({
    description:
      "Cancel a scheduled Resend email that has not yet been sent. Only works for emails with a future scheduled_at.",
    inputSchema: z.object({
      email_id: z.string().describe("Resend email ID to cancel"),
    }),
    execute: async ({ email_id }) => {
      const result = await resend().emails.cancel(email_id);
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify({ cancelled: true, email_id });
    },
  }),
);
