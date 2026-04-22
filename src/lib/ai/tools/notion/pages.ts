import type {
  CreatePageParameters,
  GetPageMarkdownParameters,
  UpdatePageMarkdownParameters,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { notion } from "./client.ts";

function parseIcon(icon: string | undefined) {
  if (!icon) return undefined;
  if (icon.startsWith("http")) return { type: "external" as const, external: { url: icon } };
  return { type: "emoji" as const, emoji: icon };
}

function parseCover(cover: string | undefined) {
  if (!cover) return undefined;
  return { type: "external" as const, external: { url: cover } };
}

export const create_page = tool({
  description: `Create a new Notion page. Can be a subpage of another page, or a new entry in a database. Pass markdown for the page body — the first # heading becomes the title if properties.title is omitted. For database entries, set properties matching the database schema (use retrieve_database first).`,
  inputSchema: z.object({
    parent_type: z.enum(["page_id", "database_id"]).describe("Parent type"),
    parent_id: z.string().describe("Parent page or database UUID"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Page properties (Notion property format)"),
    markdown: z.string().optional().describe("Page body content as markdown"),
    icon: z.string().optional().describe("Emoji or external URL for page icon"),
    cover: z.string().optional().describe("External URL for page cover image"),
  }),
  execute: async ({ parent_type, parent_id, properties, markdown, icon, cover }) => {
    const params = {
      parent: { [parent_type]: parent_id },
      properties: properties ?? {},
      markdown,
      icon: parseIcon(icon),
      cover: parseCover(cover),
    } as CreatePageParameters;

    const page = await notion.pages.create(params);
    return JSON.stringify({
      id: page.id,
      url: "url" in page ? page.url : undefined,
      created_time: "created_time" in page ? page.created_time : undefined,
    });
  },
});

export const update_page = tool({
  description: `Update a page's properties, icon, cover, or archived status. Only include fields to change. For database entries, properties must match the database schema. Set archived: true to soft-delete.`,
  inputSchema: z.object({
    page_id: z.string().describe("Page UUID"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Properties to update (Notion property format)"),
    icon: z.string().optional().describe("Emoji or external URL for page icon"),
    cover: z.string().optional().describe("External URL for page cover image"),
    archived: z.boolean().optional().describe("Set true to archive (soft-delete)"),
  }),
  execute: async ({ page_id, properties, icon, cover, archived }) => {
    const params = {
      page_id,
      properties,
      archived,
      icon: parseIcon(icon),
      cover: parseCover(cover),
    } as UpdatePageParameters;

    const page = await notion.pages.update(params);
    return JSON.stringify({
      id: page.id,
      url: "url" in page ? page.url : undefined,
      last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
    });
  },
});

export const retrieve_page_property = tool({
  description: `Get a single property value from a page, with pagination for large values (relations, rollups, rich_text). Use retrieve_page first to see all property IDs.`,
  inputSchema: z.object({
    page_id: z.string().describe("Page UUID"),
    property_id: z.string().describe("Property ID (from retrieve_page results)"),
    start_cursor: z.string().optional(),
    page_size: z.number().max(100).optional(),
  }),
  execute: async ({ page_id, property_id, start_cursor, page_size }) => {
    const result = await notion.pages.properties.retrieve({
      page_id,
      property_id,
      start_cursor,
      page_size: page_size ?? 25,
    });
    return JSON.stringify(result);
  },
});

export const read_page_content = tool({
  description: `Read a page's full body content as markdown. Returns the complete page content including headings, lists, code blocks, etc. Use this to see what's on a page before editing.`,
  inputSchema: z.object({
    page_id: z.string().describe("Page UUID"),
  }),
  execute: async ({ page_id }) => {
    const result = await notion.pages.retrieveMarkdown({ page_id } as GetPageMarkdownParameters);
    return JSON.stringify({ markdown: result.markdown, truncated: result.truncated });
  },
});

// destructive
export const archive_page = tool({
  description:
    "Archive (soft-delete) a Notion page. Equivalent to update_page with archived=true, but as an explicit intent.",
  inputSchema: z.object({
    page_id: z.string().describe("Page UUID"),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.update({
      page_id,
      archived: true,
    } as UpdatePageParameters);
    return JSON.stringify({
      id: page.id,
      archived: "archived" in page ? page.archived : true,
    });
  },
});

export const update_page_content = tool({
  description: `Update a page's body content using markdown. Two modes: "replace_content" replaces the entire page body, or "update_content" does search-and-replace on specific text. Use read_page_content first to see current content.`,
  inputSchema: z.object({
    page_id: z.string().describe("Page UUID"),
    mode: z
      .enum(["replace_content", "update_content"])
      .describe("Replace entire body or search-and-replace"),
    new_content: z.string().optional().describe("Full markdown content (for replace_content mode)"),
    old_str: z.string().optional().describe("Text to find (for update_content mode)"),
    new_str: z.string().optional().describe("Replacement text (for update_content mode)"),
  }),
  execute: async ({ page_id, mode, new_content, old_str, new_str }) => {
    const params =
      mode === "replace_content"
        ? {
            page_id,
            type: "replace_content" as const,
            replace_content: { new_str: new_content ?? "" },
          }
        : {
            page_id,
            type: "update_content" as const,
            update_content: {
              content_updates: [{ old_str: old_str ?? "", new_str: new_str ?? "" }],
            },
          };

    const result = await notion.pages.updateMarkdown(params as UpdatePageMarkdownParameters);
    return JSON.stringify({ markdown: result.markdown, truncated: result.truncated });
  },
});
