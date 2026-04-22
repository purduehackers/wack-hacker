import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { resend } from "./client.ts";

export const list_broadcasts = tool({
  description:
    "List Resend broadcasts (mass email campaigns). Returns each broadcast's id, name, status, audience, scheduled_at, and created_at.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await resend().broadcasts.list();
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data?.data ?? []);
  },
});

export const get_broadcast = tool({
  description: "Get a single Resend broadcast by ID, including content preview and status.",
  inputSchema: z.object({
    broadcast_id: z.string().describe("Resend broadcast ID"),
  }),
  execute: async ({ broadcast_id }) => {
    const result = await resend().broadcasts.get(broadcast_id);
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const create_broadcast = tool({
  description:
    "Create a new Resend broadcast (mass email campaign) targeting a segment. Supply subject, content (html and/or text), and the segment to send to. The broadcast is created in draft state — call send_broadcast to dispatch.",
  inputSchema: z.object({
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
      html,
      replyTo: reply_to,
    });
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const send_broadcast = approval(
  tool({
    description:
      "Dispatch a Resend broadcast to its target audience. Optionally schedule for a future time with scheduled_at (ISO 8601 or natural-language like 'in 1 hour'). Once sent, cannot be undone.",
    inputSchema: z.object({
      broadcast_id: z.string().describe("Resend broadcast ID"),
      scheduled_at: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp or natural language like 'in 1 hour'"),
    }),
    execute: async ({ broadcast_id, scheduled_at }) => {
      const result = await resend().broadcasts.send(broadcast_id, {
        scheduledAt: scheduled_at,
      });
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify(result.data);
    },
  }),
);

export const delete_broadcast = approval(
  tool({
    description: "Delete a Resend broadcast. Cannot delete a broadcast that has been sent.",
    inputSchema: z.object({
      broadcast_id: z.string().describe("Resend broadcast ID"),
    }),
    execute: async ({ broadcast_id }) => {
      const result = await resend().broadcasts.remove(broadcast_id);
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify({ deleted: true, broadcast_id });
    },
  }),
);
