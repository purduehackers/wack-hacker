import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const create_broadcast = defineTool({
  description:
    "Create a new Resend broadcast (mass email campaign) targeting a segment. Supply subject, content (html and/or text), and the segment to send to. The broadcast is created in draft state — call send_broadcast to dispatch.",
  access: { risk: "write" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    name: z.string().describe("Human-readable name for the broadcast"),
    audience_id: z.string().describe("Resend segment ID to send to"),
    from: z.email().describe("Sender email (must be on a verified domain)"),
    subject: z.string().describe("Email subject line"),
    text: z.string().describe("Plain-text body (required — used as fallback for non-HTML clients)"),
    html: z.string().optional().describe("HTML body"),
    reply_to: z
      .union([z.email(), z.array(z.email())])
      .optional()
      .describe("Reply-to email(s)"),
  }),
  execute: async ({ name, audience_id, from, subject, html, text, reply_to }) => {
    const result = await resend().broadcasts.create({
      name,
      audienceId: audience_id,
      from,
      subject,
      text,
      ...(html === undefined ? {} : { html }),
      ...(reply_to === undefined ? {} : { replyTo: reply_to }),
    });
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
