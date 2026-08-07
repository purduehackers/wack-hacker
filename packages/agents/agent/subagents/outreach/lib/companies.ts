/* oxlint-disable unicorn/no-null -- The Notion API requires null to clear a date property. */
import type {
  CreatePageResponse,
  GetPageResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";
import { COMPANIES_DATA_SOURCE_ID } from "./constants.ts";
import { isCreateProperties, isQueryFilter, isQuerySorts } from "./notion-input.ts";
import { cursorPaginationInputShape } from "./shared-constants.ts";

type CrmPage = QueryDataSourceResponse["results"][number] | GetPageResponse | CreatePageResponse;

function summarizePage(page: CrmPage): Record<string, unknown> {
  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
    properties: "properties" in page ? page.properties : undefined,
    created_time: "created_time" in page ? page.created_time : undefined,
    last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
  };
}

export const list_companies = defineTool({
  description: `List Company pages in the CRM. Supports Notion filters/sorts against the Companies data source. Call retrieve_crm_schema first to get the exact property names and select options.`,
  access: { risk: "read" },
  input: z.object({
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
    ...cursorPaginationInputShape,
  }),
  execute: async ({ filter, sorts, page_size, start_cursor }) => {
    if (filter !== undefined && !isQueryFilter(filter)) {
      return { error: "Invalid Notion CRM filter" };
    }
    if (sorts !== undefined && !isQuerySorts(sorts)) {
      return { error: "Invalid Notion CRM sorts" };
    }
    const params: QueryDataSourceParameters = {
      data_source_id: COMPANIES_DATA_SOURCE_ID,
      ...(filter === undefined ? {} : { filter }),
      ...(sorts === undefined ? {} : { sorts }),
      page_size: page_size ?? 25,
      ...(start_cursor === undefined ? {} : { start_cursor }),
    };
    const result = await notion.dataSources.query(params);
    return {
      results: result.results.map((p) => summarizePage(p)),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  },
});

export const get_company = defineTool({
  description: `Retrieve a single Company page by its Notion page ID. Returns every property including outreach tracking state.`,
  access: { risk: "read" },
  input: z.object({
    company_id: z.string().describe("Notion page UUID for the Company row"),
  }),
  execute: async ({ company_id }) => {
    const page = await notion.pages.retrieve({ page_id: company_id });
    return summarizePage(page);
  },
});

export const create_company = defineTool({
  description: `Create a new Company row in the CRM. Provide at least the company name; other properties should match the Companies data source schema (call retrieve_crm_schema first if unsure).`,
  access: { risk: "write" },
  input: z.object({
    name: z.string().describe("Company name (required)"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Additional Notion properties keyed by property name"),
  }),
  execute: async ({ name, properties }) => {
    const additionalProperties = properties ?? {};
    if (!isCreateProperties(additionalProperties)) {
      return { error: "Invalid Notion CRM properties" };
    }
    const page = await notion.pages.create({
      parent: { data_source_id: COMPANIES_DATA_SOURCE_ID },
      properties: {
        Name: { title: [{ text: { content: name } }] },
        ...additionalProperties,
      },
    });
    return {
      id: page.id,
      url: "url" in page ? page.url : undefined,
      name,
    };
  },
});

export const archive_company = defineTool({
  description:
    "Archive (soft-delete) a Company CRM row. The Notion page is marked archived and drops out of lists but can be restored from the Notion UI.",
  access: { risk: "destructive" },
  input: z.object({
    company_id: z.string().describe("Notion page UUID for the Company row"),
  }),
  execute: async ({ company_id }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      archived: true,
    });
    return { id: page.id, archived: true };
  },
});

export const update_company_status = defineTool({
  description: `Set the Company Status property. Use an option that matches the data source schema (e.g. "Not Contacted", "Contacted", "Awaiting Response", "Donated"). Call retrieve_crm_schema first if unsure.`,
  access: { risk: "write" },
  input: z.object({
    company_id: z.string(),
    status: z.string().describe("Exact select option label from the Companies Status property"),
  }),
  execute: async ({ company_id, status }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { Status: { select: { name: status } } },
    });
    return { id: page.id, status };
  },
});

export const update_company_email = defineTool({
  description: `Set the Company Email property. Use after verifying an address via verify_email.`,
  access: { risk: "write" },
  input: z.object({
    company_id: z.string(),
    email: z.email(),
  }),
  execute: async ({ company_id, email }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { Email: { email } },
    });
    return { id: page.id, email };
  },
});

export const update_company_next_followup = defineTool({
  description: `Set the Company "Next Follow-up" date property. Pass an ISO date string (YYYY-MM-DD) or null to clear it.`,
  access: { risk: "write" },
  input: z.object({
    company_id: z.string(),
    date: z.string().nullable().describe("ISO date (YYYY-MM-DD) or null to clear"),
  }),
  execute: async ({ company_id, date }) => {
    const page = await notion.pages.update({
      page_id: company_id,
      properties: { "Next Follow-up": date ? { date: { start: date } } : { date: null } },
    });
    return { id: page.id, next_followup: date };
  },
});
