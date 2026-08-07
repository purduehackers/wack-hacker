import type {
  CreatePageResponse,
  GetPageResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";
import { CONTACTS_DATA_SOURCE_ID } from "./constants.ts";
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

export const list_contacts = defineTool({
  description: `List Contact pages in the CRM. Supports Notion filters/sorts against the Contacts data source. Call retrieve_crm_schema first to get exact property names and select options.`,
  access: { risk: "read" },
  input: z.object({
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
      data_source_id: CONTACTS_DATA_SOURCE_ID,
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

export const get_contact = defineTool({
  description: `Retrieve a single Contact page by its Notion page ID. Returns every property including outreach tracking state.`,
  access: { risk: "read" },
  input: z.object({
    contact_id: z.string().describe("Notion page UUID for the Contact row"),
  }),
  execute: async ({ contact_id }) => {
    const page = await notion.pages.retrieve({ page_id: contact_id });
    return summarizePage(page);
  },
});

export const create_contact = defineTool({
  description: `Create a new Contact row in the CRM. Provide at least a name; optionally link to a Company via the Company relation property and set any other schema properties.`,
  access: { risk: "write" },
  input: z.object({
    name: z.string().describe("Contact name (required)"),
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
      parent: { data_source_id: CONTACTS_DATA_SOURCE_ID },
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

export const archive_contact = defineTool({
  description:
    "Archive (soft-delete) a Contact CRM row. The Notion page is marked archived and drops out of lists.",
  access: { risk: "destructive" },
  input: z.object({
    contact_id: z.string().describe("Notion page UUID for the Contact row"),
  }),
  execute: async ({ contact_id }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      archived: true,
    });
    return { id: page.id, archived: true };
  },
});

export const update_contact_status = defineTool({
  description: `Set the Contact Status property. Options: "New", "Nurturing", "Active", "Inactive". Call retrieve_crm_schema first if unsure.`,
  access: { risk: "write" },
  input: z.object({
    contact_id: z.string(),
    status: z.string().describe("Exact select option label"),
  }),
  execute: async ({ contact_id, status }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: { Status: { select: { name: status } } },
    });
    return { id: page.id, status };
  },
});

export const update_contact_email = defineTool({
  description: `Set the Contact Email property. Use after verifying the address via verify_email.`,
  access: { risk: "write" },
  input: z.object({
    contact_id: z.string(),
    email: z.email(),
  }),
  execute: async ({ contact_id, email }) => {
    const page = await notion.pages.update({
      page_id: contact_id,
      properties: { Email: { email } },
    });
    return { id: page.id, email };
  },
});
