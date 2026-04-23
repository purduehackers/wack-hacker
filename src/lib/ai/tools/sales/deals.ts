import type {
  CreatePageParameters,
  QueryDataSourceParameters,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { cursorPaginationInputShape } from "../_shared/constants.ts";
import { notion } from "./client.ts";
import { DEALS_DATA_SOURCE_ID } from "./constants.ts";

function summarizePage(page: { id: string; [key: string]: unknown }): Record<string, unknown> {
  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
    properties: "properties" in page ? page.properties : undefined,
    created_time: "created_time" in page ? page.created_time : undefined,
    last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
  };
}

export const list_deals = tool({
  description: `List Deal pages in the CRM. Supports Notion filters/sorts against the Deals data source. Call retrieve_crm_schema first to learn the Stage/Priority options.`,
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
    ...cursorPaginationInputShape,
  }),
  execute: async ({ filter, sorts, page_size, start_cursor }) => {
    const params = {
      data_source_id: DEALS_DATA_SOURCE_ID,
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

export const get_deal = tool({
  description: `Retrieve a single Deal page by its Notion page ID.`,
  inputSchema: z.object({
    deal_id: z.string().describe("Notion page UUID for the Deal row"),
  }),
  execute: async ({ deal_id }) => {
    const page = await notion.pages.retrieve({ page_id: deal_id });
    return JSON.stringify(summarizePage(page as { id: string }));
  },
});

export const create_deal = tool({
  description: `Create a new Deal row. "name" becomes the Deal title. Stage defaults to "Lead" when omitted. Call retrieve_crm_schema first to confirm Stage/Priority option labels.`,
  inputSchema: z.object({
    name: z.string().describe("Deal title"),
    amount: z.number().optional().describe("Dollar amount"),
    stage: z.string().optional().describe("Status option — defaults to Lead"),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    close_date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  }),
  execute: async ({ name, amount, stage, priority, close_date, notes }) => {
    const properties: Record<string, unknown> = {
      Deal: { title: [{ text: { content: name } }] },
      Stage: { status: { name: stage ?? "Lead" } },
    };
    if (amount !== undefined) properties.Amount = { number: amount };
    if (priority) properties.Priority = { select: { name: priority } };
    if (close_date) properties["Close date"] = { date: { start: close_date } };
    if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

    const params = {
      parent: { type: "data_source_id" as const, data_source_id: DEALS_DATA_SOURCE_ID },
      properties,
    } as CreatePageParameters;
    const page = await notion.pages.create(params);
    return JSON.stringify(summarizePage(page as { id: string }));
  },
});

export const update_deal_stage = tool({
  description: `Update a Deal's Stage. Use the exact status option label (e.g. "Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"). Stage transitions are manual — do not auto-advance.`,
  inputSchema: z.object({
    deal_id: z.string(),
    stage: z.string().describe("Exact Stage status option label"),
  }),
  execute: async ({ deal_id, stage }) => {
    const page = await notion.pages.update({
      page_id: deal_id,
      properties: { Stage: { status: { name: stage } } },
    });
    return JSON.stringify({ id: page.id, stage });
  },
});

export const update_deal = tool({
  description: `Update arbitrary Deal fields (amount, priority, close date, notes). Use update_deal_stage for Stage changes.`,
  inputSchema: z.object({
    deal_id: z.string(),
    amount: z.number().optional(),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    close_date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  }),
  execute: async ({ deal_id, amount, priority, close_date, notes }) => {
    const properties: Record<string, unknown> = {};
    if (amount !== undefined) properties.Amount = { number: amount };
    if (priority) properties.Priority = { select: { name: priority } };
    if (close_date) properties["Close date"] = { date: { start: close_date } };
    if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

    const params = { page_id: deal_id, properties } as UpdatePageParameters;
    const page = await notion.pages.update(params);
    return JSON.stringify({ id: page.id, updated: Object.keys(properties) });
  },
});
