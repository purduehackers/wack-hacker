import type { SearchParameters, SearchResponse } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { firstDataSourceId, notion, richTextToPlain } from "./client.ts";
import { cursorPaginationInputShape } from "./shared-constants.ts";

type SearchResult = SearchResponse["results"][number];

/** Extract a title string from an SDK search result (page or data source). */
function extractTitle(result: SearchResult) {
  if ("title" in result) return richTextToPlain(result.title);
  if ("properties" in result) {
    const title = Object.values(result.properties).find((property) => property.type === "title");
    if (title?.type === "title") return richTextToPlain(title.title);
  }
  return "";
}

export const search_notion = defineTool({
  description: `Search the Notion workspace by keyword. Returns matching pages and databases with title, URL, and last edited time. Use type filter to narrow results.`,
  access: { risk: "read" },
  input: z.strictObject({
    query: z.string().describe("Search query"),
    filter: z
      .enum(["page", "data_source"])
      .optional()
      .describe("Filter by object type (page or data_source)"),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ query, filter, page_size, start_cursor }) => {
    const params: SearchParameters = {
      query,
      page_size: page_size ?? 20,
      ...(start_cursor === undefined ? {} : { start_cursor }),
      ...(filter === undefined ? {} : { filter: { value: filter, property: "object" } }),
    };
    const { results, has_more, next_cursor } = await notion.search(params);
    return {
      results: results.map((r) => ({
        id: r.id,
        object: r.object,
        title: extractTitle(r),
        url: "url" in r ? r.url : undefined,
        last_edited_time: "last_edited_time" in r ? r.last_edited_time : undefined,
      })),
      has_more,
      next_cursor,
    };
  },
});

export const retrieve_page = defineTool({
  description: `Get a page's properties and metadata — title, URL, parent, timestamps, icon, cover, and all property values. Use to inspect a page before modifying it.`,
  access: { risk: "read" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID or URL"),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.retrieve({ page_id });
    if (!("url" in page)) return { id: page.id };
    return {
      id: page.id,
      url: page.url,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      parent: page.parent,
      icon: page.icon,
      cover: page.cover,
      archived: page.archived,
      properties: page.properties,
    };
  },
});

export const retrieve_database = defineTool({
  description: `Get a database's schema — title, property definitions (types, options), and URL. Always call this before querying or creating entries to understand the schema.`,
  access: { risk: "read" },
  input: z.strictObject({
    database_id: z.string().describe("Database UUID or URL"),
  }),
  execute: async ({ database_id }) => {
    const db = await notion.databases.retrieve({ database_id });
    if (!("url" in db)) return { id: db.id };
    const dataSource = await notion.dataSources.retrieve({
      data_source_id: firstDataSourceId(db),
    });
    return {
      id: db.id,
      title: richTextToPlain(db.title),
      url: db.url,
      properties: "properties" in dataSource ? dataSource.properties : undefined,
      parent: db.parent,
      data_source_id: dataSource.id,
    };
  },
});

export const retrieve_user = defineTool({
  description:
    "Get a single Notion user by ID. Returns name, email (for people), type (person or bot), and avatar URL.",
  access: { risk: "read" },
  input: z.strictObject({
    user_id: z.string().describe("Notion user UUID"),
  }),
  execute: async ({ user_id }) => {
    const u = await notion.users.retrieve({ user_id });
    return {
      id: u.id,
      name: u.name,
      type: u.type,
      avatar_url: u.avatar_url,
      email: u.type === "person" ? u.person.email : undefined,
    };
  },
});

export const retrieve_bot_user = defineTool({
  description:
    "Get info about the bot user backing this integration — useful for confirming which workspace and user the integration is acting as.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const me = await notion.users.me({});
    return {
      id: me.id,
      name: me.name,
      type: me.type,
      workspace_name: me.type === "bot" ? me.bot.workspace_name : undefined,
    };
  },
});

export const list_users = defineTool({
  description: `List workspace users. Returns name, email, type (person or bot), and avatar URL. Use to resolve user names to IDs for people properties.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...cursorPaginationInputShape,
  }),
  execute: async ({ start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.users.list({
      ...(start_cursor === undefined ? {} : { start_cursor }),
      page_size: page_size ?? 50,
    });
    return {
      users: results.map((u) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        avatar_url: u.avatar_url,
        email: u.type === "person" ? u.person.email : undefined,
      })),
      has_more,
      next_cursor,
    };
  },
});
