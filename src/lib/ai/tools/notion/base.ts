import type { SearchParameters } from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { notion, richTextToPlain } from "./client.ts";

/** Extract a title string from a search result (page or database). */
function extractTitle(r: { object: string; [key: string]: unknown }) {
  if ("title" in r && Array.isArray(r.title)) {
    return richTextToPlain(r.title);
  }
  if ("properties" in r && r.properties && typeof r.properties === "object") {
    const props = r.properties as Record<string, { title?: Array<{ plain_text: string }> }>;
    const titleProp = props.title?.title ?? props.Name?.title;
    if (titleProp) return richTextToPlain(titleProp);
  }
  return "";
}

export const search_notion = tool({
  description: `Search the Notion workspace by keyword. Returns matching pages and databases with title, URL, and last edited time. Use type filter to narrow results.`,
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    filter: z
      .enum(["page", "data_source"])
      .optional()
      .describe("Filter by object type (page or data_source)"),
    page_size: z.number().max(100).optional(),
    start_cursor: z.string().optional(),
  }),
  execute: async ({ query, filter, page_size, start_cursor }) => {
    const params: SearchParameters = {
      query,
      page_size: page_size ?? 20,
      start_cursor,
      ...(filter && { filter: { value: filter, property: "object" } }),
    };
    const { results, has_more, next_cursor } = await notion.search(params);
    return JSON.stringify({
      results: results.map((r) => ({
        id: r.id,
        object: r.object,
        title: extractTitle(r),
        url: "url" in r ? r.url : undefined,
        last_edited_time: "last_edited_time" in r ? r.last_edited_time : undefined,
      })),
      has_more,
      next_cursor,
    });
  },
});

export const retrieve_page = tool({
  description: `Get a page's properties and metadata — title, URL, parent, timestamps, icon, cover, and all property values. Use to inspect a page before modifying it.`,
  inputSchema: z.object({
    page_id: z.string().describe("Page UUID or URL"),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.retrieve({ page_id });
    if (!("url" in page)) return JSON.stringify({ id: page.id });
    return JSON.stringify({
      id: page.id,
      url: page.url,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      parent: page.parent,
      icon: page.icon,
      cover: page.cover,
      archived: page.archived,
      properties: page.properties,
    });
  },
});

export const retrieve_database = tool({
  description: `Get a database's schema — title, property definitions (types, options), and URL. Always call this before querying or creating entries to understand the schema.`,
  inputSchema: z.object({
    database_id: z.string().describe("Database UUID or URL"),
  }),
  execute: async ({ database_id }) => {
    const db = await notion.databases.retrieve({ database_id });
    if (!("url" in db)) return JSON.stringify({ id: db.id });
    return JSON.stringify({
      id: db.id,
      title: richTextToPlain(db.title),
      url: db.url,
      properties: "properties" in db ? db.properties : undefined,
      parent: db.parent,
    });
  },
});

export const list_users = tool({
  description: `List workspace users. Returns name, email, type (person or bot), and avatar URL. Use to resolve user names to IDs for people properties.`,
  inputSchema: z.object({
    start_cursor: z.string().optional(),
    page_size: z.number().max(100).optional(),
  }),
  execute: async ({ start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.users.list({
      start_cursor,
      page_size: page_size ?? 50,
    });
    return JSON.stringify({
      users: results.map((u) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        avatar_url: u.avatar_url,
        email: u.type === "person" ? u.person.email : undefined,
      })),
      has_more,
      next_cursor,
    });
  },
});
