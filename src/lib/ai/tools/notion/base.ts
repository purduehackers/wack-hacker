import type { SearchParameters } from "@notionhq/client/build/src/api-endpoints";

import { z } from "zod";

import { cursorPaginationInputShape } from "../_shared/constants.ts";
import { defineTool } from "../_shared/define-tool.ts";
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

export const search_notion = defineTool({
  name: "search_notion",
  domain: "notion",
  description: `Search the Notion workspace by keyword. Returns matching pages and databases with title, URL, and last edited time. Use type filter to narrow results.`,
  access: { risk: "read" },
  input: z.object({
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

export const retrieve_page = defineTool({
  name: "retrieve_page",
  domain: "notion",
  description: `Get a page's properties and metadata — title, URL, parent, timestamps, icon, cover, and all property values. Use to inspect a page before modifying it.`,
  access: { risk: "read" },
  input: z.object({
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

export const retrieve_database = defineTool({
  name: "retrieve_database",
  domain: "notion",
  description: `Get a database's schema — title, property definitions (types, options), and URL. Always call this before querying or creating entries to understand the schema.`,
  access: { risk: "read" },
  input: z.object({
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

export const retrieve_user = defineTool({
  name: "retrieve_user",
  domain: "notion",
  description:
    "Get a single Notion user by ID. Returns name, email (for people), type (person or bot), and avatar URL.",
  access: { risk: "read" },
  input: z.object({
    user_id: z.string().describe("Notion user UUID"),
  }),
  execute: async ({ user_id }) => {
    const u = await notion.users.retrieve({ user_id });
    return JSON.stringify({
      id: u.id,
      name: u.name,
      type: u.type,
      avatar_url: u.avatar_url,
      email: u.type === "person" ? u.person.email : undefined,
    });
  },
});

export const retrieve_bot_user = defineTool({
  name: "retrieve_bot_user",
  domain: "notion",
  description:
    "Get info about the bot user backing this integration — useful for confirming which workspace and user the integration is acting as.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const me = await notion.users.me({});
    return JSON.stringify({
      id: me.id,
      name: me.name,
      type: me.type,
      workspace_name: me.type === "bot" ? me.bot.workspace_name : undefined,
    });
  },
});

export const list_users = defineTool({
  name: "list_users",
  domain: "notion",
  description: `List workspace users. Returns name, email, type (person or bot), and avatar URL. Use to resolve user names to IDs for people properties.`,
  access: { risk: "read" },
  input: z.object({
    ...cursorPaginationInputShape,
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
