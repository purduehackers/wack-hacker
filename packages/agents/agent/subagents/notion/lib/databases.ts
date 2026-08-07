import type {
  CreateDatabaseParameters,
  QueryDataSourceParameters,
  UpdateDatabaseParameters,
  UpdateDataSourceParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { firstDataSourceId, notion, resolveDataSourceId, richTextToPlain } from "./client.ts";
import { defineTool } from "./define-tool.ts";
import {
  isCreateDataSourceProperties,
  isQueryFilter,
  isQuerySorts,
  isUpdateDataSourceProperties,
} from "./notion-input.ts";
import { cursorPaginationInputShape } from "./shared-constants.ts";

export const query_database = defineTool({
  name: "query_database",
  domain: "notion",
  description: `Query a database with optional filters and sorts. Returns matching pages with their properties. Always call retrieve_database first to understand the schema before building filters. Supports pagination via start_cursor.`,
  access: { risk: "read" },
  input: z.object({
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
    if (filter !== undefined && !isQueryFilter(filter)) {
      return { error: "Invalid Notion database filter" };
    }
    if (sorts !== undefined && !isQuerySorts(sorts)) {
      return { error: "Invalid Notion database sorts" };
    }
    const dataSourceId = await resolveDataSourceId(database_id);
    const params: QueryDataSourceParameters = {
      data_source_id: dataSourceId,
      ...(filter === undefined ? {} : { filter }),
      ...(sorts === undefined ? {} : { sorts }),
      page_size: page_size ?? 25,
      ...(start_cursor === undefined ? {} : { start_cursor }),
    };

    const result = await notion.dataSources.query(params);
    return {
      results: result.results.map((page) => ({
        id: page.id,
        url: "url" in page ? page.url : undefined,
        properties: "properties" in page ? page.properties : undefined,
        created_time: "created_time" in page ? page.created_time : undefined,
        last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
      })),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  },
});

export const create_database = defineTool({
  name: "create_database",
  domain: "notion",
  description: `Create a new database as a child of a page. Requires a title property at minimum. Define the property schema — supported types: title, rich_text, number, select, multi_select, status, date, checkbox, people, url, email, relation.`,
  access: { risk: "write" },
  input: z.object({
    parent_page_id: z.string().describe("Parent page UUID"),
    title: z.string().describe("Database title"),
    properties: z
      .record(z.string(), z.unknown())
      .describe(
        "Property schema (e.g. { Name: { title: {} }, Status: { select: { options: [...] } } })",
      ),
  }),
  execute: async ({ parent_page_id, title, properties }) => {
    if (!isCreateDataSourceProperties(properties)) {
      return { error: "Invalid Notion data-source property schema (a title property is required)" };
    }
    const params: CreateDatabaseParameters = {
      parent: { type: "page_id", page_id: parent_page_id },
      title: [{ text: { content: title } }],
      initial_data_source: { properties },
    };

    const db = await notion.databases.create(params);
    return {
      id: db.id,
      url: "url" in db ? db.url : undefined,
      title: "title" in db ? richTextToPlain(db.title) : title,
    };
  },
});

export const update_database = defineTool({
  name: "update_database",
  domain: "notion",
  description: `Update a database's title or property schema. To add a property, include it in properties. To rename, use the property ID as the key. To delete, set the property to null.`,
  access: { risk: "write" },
  input: z.object({
    database_id: z.string().describe("Database UUID"),
    title: z.string().optional().describe("New database title"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Properties to add, update, or remove (set to null)"),
  }),
  execute: async ({ database_id, title, properties }) => {
    if (properties !== undefined && !isUpdateDataSourceProperties(properties)) {
      return { error: "Invalid Notion data-source property update" };
    }
    const current = await notion.databases.retrieve({ database_id });
    if (properties !== undefined) {
      const dataSourceParams: UpdateDataSourceParameters = {
        data_source_id: firstDataSourceId(current),
        properties,
      };
      await notion.dataSources.update(dataSourceParams);
    }
    const databaseParams: UpdateDatabaseParameters = {
      database_id,
      ...(title === undefined ? {} : { title: [{ text: { content: title } }] }),
    };
    if (title !== undefined) await notion.databases.update(databaseParams);
    const db = await notion.databases.retrieve({ database_id });
    return {
      id: db.id,
      url: "url" in db ? db.url : undefined,
      title: "title" in db ? richTextToPlain(db.title) : title,
    };
  },
});

export const archive_database = defineTool({
  name: "archive_database",
  domain: "notion",
  description:
    "Archive (soft-delete) a Notion database. The database and its pages become hidden from default views but can be restored from the Notion UI.",
  access: { risk: "destructive" },
  input: z.object({
    database_id: z.string().describe("Database UUID"),
  }),
  execute: async ({ database_id }) => {
    const db = await notion.databases.update({
      database_id,
      in_trash: true,
    });
    return {
      id: db.id,
      archived: "in_trash" in db ? db.in_trash : true,
    };
  },
});
