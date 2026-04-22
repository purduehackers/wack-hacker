import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { resend } from "./client.ts";

export const list_audiences = tool({
  description:
    "List Resend segments (audiences) used for grouping contacts. Returns each segment's id, name, and creation timestamp.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await resend().segments.list();
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data?.data ?? []);
  },
});

export const get_audience = tool({
  description: "Get a single Resend segment (audience) by ID.",
  inputSchema: z.object({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().segments.get(audience_id);
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const create_audience = tool({
  description: "Create a new Resend segment (audience).",
  inputSchema: z.object({
    name: z.string().describe("Segment name"),
  }),
  execute: async ({ name }) => {
    const result = await resend().segments.create({ name });
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const delete_audience = approval(
  tool({
    description:
      "Delete a Resend segment (audience). Contacts in the segment are not deleted; they lose their segment membership.",
    inputSchema: z.object({
      audience_id: z.string().describe("Resend segment ID"),
    }),
    execute: async ({ audience_id }) => {
      const result = await resend().segments.remove(audience_id);
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify({ deleted: true, audience_id });
    },
  }),
);

export const list_contacts_in_audience = tool({
  description:
    "List contacts in a Resend segment (audience). Returns each contact's id, email, first/last name, and subscription state.",
  inputSchema: z.object({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().contacts.list({ audienceId: audience_id });
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data?.data ?? []);
  },
});

export const add_contact_to_audience = tool({
  description: "Add a contact to a Resend segment (audience) by email. Creates the contact if new.",
  inputSchema: z.object({
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
      firstName: first_name,
      lastName: last_name,
      unsubscribed,
    });
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const remove_contact_from_audience = approval(
  tool({
    description:
      "Remove a contact from a Resend segment (audience). Provide either contact_id or email.",
    inputSchema: z.object({
      audience_id: z.string().describe("Resend segment ID"),
      contact_id: z.string().optional().describe("Contact ID (preferred)"),
      email: z.email().optional().describe("Contact email (used if contact_id omitted)"),
    }),
    execute: async ({ audience_id, contact_id, email }) => {
      if (!contact_id && !email) {
        return JSON.stringify({ error: "Provide contact_id or email" });
      }
      const result = contact_id
        ? await resend().contacts.remove({ audienceId: audience_id, id: contact_id })
        : await resend().contacts.remove({ audienceId: audience_id, email: email as string });
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify({ removed: true, audience_id, contact_id, email });
    },
  }),
);
