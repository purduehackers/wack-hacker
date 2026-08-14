import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "../../client.ts";

export const send_email = defineTool({
  description:
    "Send one transactional email from a verified sending domain. Irreversible. The From address must belong to a domain onboarded for Email Sending — check with list_sending_subdomains if unsure. For CRM outreach use the outreach subagent's send_outreach_email instead, which also records the send against the contact.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    from: z.email().describe("Must be on a domain onboarded for Email Sending"),
    to: z.array(z.email()).min(1).max(50),
    subject: z.string().min(1),
    text: z.string().min(1).describe("Plain-text body"),
    html: z.string().min(1).optional(),
    reply_to: z.email().optional(),
    cc: z.array(z.email()).optional(),
    bcc: z.array(z.email()).optional(),
  }),
  execute: async ({ from, to, subject, text, html, reply_to, cc, bcc }) => {
    const result = await cloudflare().emailSending.send({
      account_id: accountId(),
      from,
      to,
      subject,
      text,
      ...(html !== undefined && { html }),
      ...(reply_to !== undefined && { reply_to }),
      ...(cc !== undefined && { cc }),
      ...(bcc !== undefined && { bcc }),
    });
    // Permanent bounces come back in a 2xx body rather than as an error, so a
    // caller that only checks for a thrown error would report a dead address as
    // a successful send.
    return {
      message_id: result.message_id,
      delivered: result.delivered,
      queued: result.queued,
      permanent_bounces: result.permanent_bounces,
    };
  },
});
