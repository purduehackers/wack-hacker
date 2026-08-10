import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { resend } from "./client.ts";

export const list_audiences = defineTool({
  description:
    "List Resend segments (audiences) used for grouping contacts. Returns each segment's id, name, and creation timestamp.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await resend().segments.list();
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});

export const get_audience = defineTool({
  description: "Get a single Resend segment (audience) by ID.",
  access: { risk: "read" },
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().segments.get(audience_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});

export const create_audience = defineTool({
  description: "Create a new Resend segment (audience).",
  access: { risk: "write" },
  input: z.strictObject({
    name: z.string().describe("Segment name"),
  }),
  execute: async ({ name }) => {
    const result = await resend().segments.create({ name });
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});

export const delete_audience = defineTool({
  description:
    "Delete a Resend segment (audience). Contacts in the segment are not deleted; they lose their segment membership.",
  access: { risk: "destructive" },
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().segments.remove(audience_id);
    if (result.error) return { error: result.error.message };
    return { deleted: true, audience_id };
  },
});

export const list_contacts_in_audience = defineTool({
  description:
    "List contacts in a Resend segment (audience). Returns each contact's id, email, first/last name, and subscription state.",
  access: { risk: "read" },
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().contacts.list({ audienceId: audience_id });
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});

export const add_contact_to_audience = defineTool({
  description: "Add a contact to a Resend segment (audience) by email. Creates the contact if new.",
  access: { risk: "write" },
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

export const remove_contact_from_audience = defineTool({
  description:
    "Remove a contact from a Resend segment (audience). Provide either contact_id or email.",
  access: { risk: "destructive" },
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
