import type { QueryDataSourceParameters } from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { contactsDataSourceId, notion } from "./client.ts";

function summarizePage(page: { id: string; [key: string]: unknown }): Record<string, unknown> {
  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
    properties: "properties" in page ? page.properties : undefined,
    created_time: "created_time" in page ? page.created_time : undefined,
    last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
  };
}

export const list_contacts = tool({
  description: `List Contact pages in the CRM. Supports Notion filters/sorts against the Contacts data source. Call retrieve_crm_schema first to get exact property names and select options.`,
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    sorts: z
      .array(
        z.object({
          property: z.string().optional(),
          timestamp: z.enum(["created_time", "last_edited_time"]).optional(),
          direction: z.enum(["ascending", "descending"]),
        }),
      )
      .optional(),
    page_size: z.number().max(100).optional(),
    start_cursor: z.string().optional(),
  }),
  execute: async ({ filter, sorts, page_size, start_cursor }) => {
    const params = {
      data_source_id: contactsDataSourceId(),
      filter,
      sorts,
      page_size: page_size ?? 25,
      start_cursor,
    } as QueryDataSourceParameters;
    const result = await notion.dataSources.query(params);
    return JSON.stringify({
      results: result.results.map((p) => summarizePage(p as { id: string })),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    });
  },
});

export const get_contact = tool({
  description: `Retrieve a single Contact page by its Notion page ID. Returns every property including outreach tracking state.`,
  inputSchema: z.object({
    contact_id: z.string().describe("Notion page UUID for the Contact row"),
  }),
  execute: async ({ contact_id }) => {
    const page = await notion.pages.retrieve({ page_id: contact_id });
    return JSON.stringify(summarizePage(page as { id: string }));
  },
});

export const update_contact_status = tool({
  description: `Set the Contact Status property. Options: "New", "Nurturing", "Active", "Inactive". Call retrieve_crm_schema first if unsure.`,
  inputSchema: z.object({
    contact_id: z.string(),
    status: z.string().describe("Exact select option label"),
  }),
  execute: async ({ contact_id, status }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: { Status: { select: { name: status } } },
    });
    return JSON.stringify({ id: page.id, status });
  },
});

export const update_contact_email = tool({
  description: `Set the Contact Email property. Use after verifying the address via verify_email.`,
  inputSchema: z.object({
    contact_id: z.string(),
    email: z.email(),
  }),
  execute: async ({ contact_id, email }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: { Email: { email } },
    });
    return JSON.stringify({ id: page.id, email });
  },
});

export const set_contact_last_outreach = tool({
  description: `Write the Resend email id to the Contact's "Last Outreach ID" property and set "Outreach Status" to "Sent" with an event timestamp. Called automatically by send_outreach_email — do not call directly unless reconciling state.`,
  inputSchema: z.object({
    contact_id: z.string(),
    email_id: z.string().describe("Resend email id"),
    sent_at: z.string().describe("ISO timestamp the email was sent"),
  }),
  execute: async ({ contact_id, email_id, sent_at }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: {
        "Last Outreach ID": { rich_text: [{ text: { content: email_id } }] },
        "Outreach Status": { select: { name: "Sent" } },
        "Outreach Last Event At": { date: { start: sent_at } },
      },
    });
    return JSON.stringify({ id: page.id, email_id, sent_at });
  },
});
