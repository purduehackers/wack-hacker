import type {
  CreateDatabaseParameters,
  QueryDataSourceParameters,
  UpdateDatabaseParameters,
} from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { cursorPaginationInputShape } from "../_shared/constants.ts";
import { notion, richTextToPlain } from "./client.ts";

export const query_database = tool({
  description: `Query a database with optional filters and sorts. Returns matching pages with their properties. Always call retrieve_database first to understand the schema before building filters. Supports pagination via start_cursor.`,
  inputSchema: z.object({
    database_id: z.string().describe("Database UUID"),
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Notion filter object (see skill guidance for syntax)"),
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
  execute: async ({ database_id, filter, sorts, page_size, start_cursor }) => {
    const params = {
      data_source_id: database_id,
      filter,
      sorts,
      page_size: page_size ?? 25,
      start_cursor,
    } as QueryDataSourceParameters;

    const result = await notion.dataSources.query(params);
    return JSON.stringify({
      results: result.results.map((page) => ({
        id: page.id,
        url: "url" in page ? page.url : undefined,
        properties: "properties" in page ? page.properties : undefined,
        created_time: "created_time" in page ? page.created_time : undefined,
        last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
      })),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    });
  },
});

export const create_database = tool({
  description: `Create a new database as a child of a page. Requires a title property at minimum. Define the property schema — supported types: title, rich_text, number, select, multi_select, status, date, checkbox, people, url, email, relation.`,
  inputSchema: z.object({
    parent_page_id: z.string().describe("Parent page UUID"),
    title: z.string().describe("Database title"),
    properties: z
      .record(z.string(), z.unknown())
      .describe(
        "Property schema (e.g. { Name: { title: {} }, Status: { select: { options: [...] } } })",
      ),
  }),
  execute: async ({ parent_page_id, title, properties }) => {
    const params = {
      parent: { type: "page_id" as const, page_id: parent_page_id },
      title: [{ text: { content: title } }],
      properties,
    } as CreateDatabaseParameters;

    const db = await notion.databases.create(params);
    return JSON.stringify({
      id: db.id,
      url: "url" in db ? db.url : undefined,
      title: "title" in db ? richTextToPlain(db.title) : title,
    });
  },
});

export const update_database = tool({
  description: `Update a database's title or property schema. To add a property, include it in properties. To rename, use the property ID as the key. To delete, set the property to null.`,
  inputSchema: z.object({
    database_id: z.string().describe("Database UUID"),
    title: z.string().optional().describe("New database title"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Properties to add, update, or remove (set to null)"),
  }),
  execute: async ({ database_id, title, properties }) => {
    const params = {
      database_id,
      title: title ? [{ text: { content: title } }] : undefined,
      properties,
    } as UpdateDatabaseParameters;

    const db = await notion.databases.update(params);
    return JSON.stringify({
      id: db.id,
      url: "url" in db ? db.url : undefined,
      title: "title" in db ? richTextToPlain(db.title) : title,
    });
  },
});

export const archive_database = approval(
  tool({
    description:
      "Archive (soft-delete) a Notion database. The database and its pages become hidden from default views but can be restored from the Notion UI.",
    inputSchema: z.object({
      database_id: z.string().describe("Database UUID"),
    }),
    execute: async ({ database_id }) => {
      const db = await notion.databases.update({
        database_id,
        archived: true,
      } as UpdateDatabaseParameters);
      return JSON.stringify({
        id: db.id,
        archived: "archived" in db ? db.archived : true,
      });
    },
  }),
);
