import type {
  CreatePageParameters,
  CreatePageResponse,
  GetPageResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";
import { DEALS_DATA_SOURCE_ID } from "./constants.ts";
import { isQueryFilter, isQuerySorts } from "./notion-input.ts";
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

export const list_deals = defineTool({
  description: `List Deal pages in the CRM. Supports Notion filters/sorts against the Deals data source. Call retrieve_crm_schema first to learn the Stage/Priority options.`,
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
      data_source_id: DEALS_DATA_SOURCE_ID,
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

export const get_deal = defineTool({
  description: `Retrieve a single Deal page by its Notion page ID.`,
  access: { risk: "read" },
  input: z.object({
    deal_id: z.string().describe("Notion page UUID for the Deal row"),
  }),
  execute: async ({ deal_id }) => {
    const page = await notion.pages.retrieve({ page_id: deal_id });
    return summarizePage(page);
  },
});

export const create_deal = defineTool({
  description: `Create a new Deal row. "name" becomes the Deal title. Stage defaults to "Lead" when omitted. Call retrieve_crm_schema first to confirm Stage/Priority option labels.`,
  access: { risk: "write" },
  input: z.object({
    name: z.string().describe("Deal title"),
    amount: z.number().optional().describe("Dollar amount"),
    stage: z.string().optional().describe("Status option — defaults to Lead"),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    close_date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  }),
  execute: async ({ name, amount, stage, priority, close_date, notes }) => {
    const properties: CreatePageParameters["properties"] = {
      Deal: { title: [{ text: { content: name } }] },
      Stage: { status: { name: stage ?? "Lead" } },
    };
    if (amount !== undefined) properties.Amount = { number: amount };
    if (priority) properties.Priority = { select: { name: priority } };
    if (close_date) properties["Close date"] = { date: { start: close_date } };
    if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

    const params: CreatePageParameters = {
      parent: { type: "data_source_id", data_source_id: DEALS_DATA_SOURCE_ID },
      properties,
    };
    const page = await notion.pages.create(params);
    return summarizePage(page);
  },
});

export const update_deal_stage = defineTool({
  description: `Update a Deal's Stage. Use the exact status option label (e.g. "Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"). Stage transitions are manual — do not auto-advance.`,
  access: { risk: "write" },
  input: z.object({
    deal_id: z.string(),
    stage: z.string().describe("Exact Stage status option label"),
  }),
  execute: async ({ deal_id, stage }) => {
    const page = await notion.pages.update({
      page_id: deal_id,
      properties: { Stage: { status: { name: stage } } },
    });
    return { id: page.id, stage };
  },
});

export const update_deal = defineTool({
  description: `Update arbitrary Deal fields (amount, priority, close date, notes). Use update_deal_stage for Stage changes.`,
  access: { risk: "write" },
  input: z.object({
    deal_id: z.string(),
    amount: z.number().optional(),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    close_date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  }),
  execute: async ({ deal_id, amount, priority, close_date, notes }) => {
    const properties: UpdatePageParameters["properties"] = {};
    if (amount !== undefined) properties.Amount = { number: amount };
    if (priority) properties.Priority = { select: { name: priority } };
    if (close_date) properties["Close date"] = { date: { start: close_date } };
    if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

    const params: UpdatePageParameters = { page_id: deal_id, properties };
    const page = await notion.pages.update(params);
    return { id: page.id, updated: Object.keys(properties) };
  },
});
