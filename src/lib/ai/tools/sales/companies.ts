import type { QueryDataSourceParameters } from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { notion } from "./client.ts";
import { COMPANIES_DATA_SOURCE_ID } from "./constants.ts";

function summarizePage(page: { id: string; [key: string]: unknown }): Record<string, unknown> {
  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
    properties: "properties" in page ? page.properties : undefined,
    created_time: "created_time" in page ? page.created_time : undefined,
    last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
  };
}

export const list_companies = tool({
  description: `List Company pages in the CRM. Supports Notion filters/sorts against the Companies data source. Call retrieve_crm_schema first to get the exact property names and select options.`,
  inputSchema: z.object({
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Notion filter object targeting the Companies schema"),
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
      data_source_id: COMPANIES_DATA_SOURCE_ID,
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

export const get_company = tool({
  description: `Retrieve a single Company page by its Notion page ID. Returns every property including outreach tracking state.`,
  inputSchema: z.object({
    company_id: z.string().describe("Notion page UUID for the Company row"),
  }),
  execute: async ({ company_id }) => {
    const page = await notion.pages.retrieve({ page_id: company_id });
    return JSON.stringify(summarizePage(page as { id: string }));
  },
});

export const create_company = tool({
  description: `Create a new Company row in the CRM. Provide at least the company name; other properties should match the Companies data source schema (call retrieve_crm_schema first if unsure).`,
  inputSchema: z.object({
    name: z.string().describe("Company name (required)"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Additional Notion properties keyed by property name"),
  }),
  execute: async ({ name, properties }) => {
    const page = await notion.pages.create({
      parent: { data_source_id: COMPANIES_DATA_SOURCE_ID },
      properties: {
        Name: { title: [{ text: { content: name } }] },
        ...properties,
      },
    } as Parameters<typeof notion.pages.create>[0]);
    return JSON.stringify({
      id: page.id,
      url: "url" in page ? page.url : undefined,
      name,
    });
  },
});

export const archive_company = approval(
  tool({
    description:
      "Archive (soft-delete) a Company CRM row. The Notion page is marked archived and drops out of lists but can be restored from the Notion UI.",
    inputSchema: z.object({
      company_id: z.string().describe("Notion page UUID for the Company row"),
    }),
    execute: async ({ company_id }) => {
      const page = await notion.pages.update({
        page_id: company_id,
        archived: true,
      } as Parameters<typeof notion.pages.update>[0]);
      return JSON.stringify({ id: page.id, archived: true });
    },
  }),
);

export const update_company_status = tool({
  description: `Set the Company Status property. Use an option that matches the data source schema (e.g. "Not Contacted", "Contacted", "Awaiting Response", "Donated"). Call retrieve_crm_schema first if unsure.`,
  inputSchema: z.object({
    company_id: z.string(),
    status: z.string().describe("Exact select option label from the Companies Status property"),
  }),
  execute: async ({ company_id, status }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { Status: { select: { name: status } } },
    });
    return JSON.stringify({ id: page.id, status });
  },
});

export const update_company_email = tool({
  description: `Set the Company Email property. Use after verifying an address via verify_email.`,
  inputSchema: z.object({
    company_id: z.string(),
    email: z.email(),
  }),
  execute: async ({ company_id, email }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { Email: { email } },
    });
    return JSON.stringify({ id: page.id, email });
  },
});

export const update_company_next_followup = tool({
  description: `Set the Company "Next Follow-up" date property. Pass an ISO date string (YYYY-MM-DD) or null to clear it.`,
  inputSchema: z.object({
    company_id: z.string(),
    date: z.string().nullable().describe("ISO date (YYYY-MM-DD) or null to clear"),
  }),
  execute: async ({ company_id, date }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { "Next Follow-up": date ? { date: { start: date } } : { date: null } },
    });
    return JSON.stringify({ id: page.id, next_followup: date });
  },
});

export const set_company_last_outreach = tool({
  description: `Write the Resend email id to the Company's "Last Outreach ID" property and set "Outreach Status" to "Sent" with an event timestamp. Called automatically by send_outreach_email — do not call directly unless reconciling state.`,
  inputSchema: z.object({
    company_id: z.string(),
    email_id: z.string().describe("Resend email id"),
    sent_at: z.string().describe("ISO timestamp the email was sent"),
  }),
  execute: async ({ company_id, email_id, sent_at }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: {
        "Last Outreach ID": { rich_text: [{ text: { content: email_id } }] },
        "Outreach Status": { select: { name: "Sent" } },
        "Outreach Last Event At": { date: { start: sent_at } },
      },
    });
    return JSON.stringify({ id: page.id, email_id, sent_at });
  },
});
