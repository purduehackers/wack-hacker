import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";
import { isAppendBlockChildrenParameters, isUpdateBlockParameters } from "./notion-input.ts";
import { cursorPaginationInputShape } from "./shared-constants.ts";

export const retrieve_block = defineTool({
  description:
    "Get a single Notion block by ID. Returns block type and its typed content. Use for inspecting individual blocks before updating.",
  access: { risk: "read" },
  input: z.object({
    block_id: z.string().describe("Block UUID"),
  }),
  execute: async ({ block_id }) => {
    return await notion.blocks.retrieve({ block_id });
  },
});

export const update_block = defineTool({
  description:
    "Update a block's content. The shape of block_content must match the existing block's type (e.g. { paragraph: { rich_text: [...] } }). Use retrieve_block first to see the current structure.",
  access: { risk: "destructive" },
  input: z.object({
    block_id: z.string().describe("Block UUID"),
    block_content: z
      .record(z.string(), z.unknown())
      .describe("Block content in Notion API format, keyed by block type"),
    archived: z.boolean().optional().describe("Set true to archive"),
  }),
  execute: async ({ block_id, block_content, archived }) => {
    const params = {
      block_id,
      ...block_content,
      ...(archived === undefined ? {} : { in_trash: archived }),
    };
    if (!isUpdateBlockParameters(params)) {
      return { error: "Invalid Notion block update content" };
    }
    return await notion.blocks.update(params);
  },
});

export const delete_block = defineTool({
  description:
    "Archive (soft-delete) a block. Notion does not permanently delete blocks — this sets archived=true.",
  access: { risk: "destructive" },
  input: z.object({
    block_id: z.string().describe("Block UUID"),
  }),
  execute: async ({ block_id }) => {
    const block = await notion.blocks.delete({ block_id });
    return {
      id: block.id,
      archived: "archived" in block ? block.archived : true,
    };
  },
});

export const list_block_children = defineTool({
  description:
    "List a block's child blocks (for a page or container block). Paginated. Returns each child's ID, type, and summary content.",
  access: { risk: "read" },
  input: z.object({
    block_id: z.string().describe("Parent block or page UUID"),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ block_id, start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.blocks.children.list({
      block_id,
      ...(start_cursor === undefined ? {} : { start_cursor }),
      page_size: page_size ?? 50,
    });
    return {
      blocks: results.map((b) => ({
        id: b.id,
        type: "type" in b ? b.type : undefined,
        has_children: "has_children" in b ? b.has_children : undefined,
        archived: "archived" in b ? b.archived : undefined,
      })),
      has_more,
      next_cursor,
    };
  },
});

export const append_block_children = defineTool({
  description:
    "Append blocks to a page or container block. children is an array of block objects in Notion API format (e.g. [{ paragraph: { rich_text: [{ text: { content: 'Hello' } }] } }]).",
  access: { risk: "write" },
  input: z.object({
    block_id: z.string().describe("Parent block or page UUID"),
    children: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe("Array of block objects to append"),
    after: z
      .string()
      .optional()
      .describe("Block UUID after which to insert the new blocks (default: end)"),
  }),
  execute: async ({ block_id, children, after }) => {
    const params = {
      block_id,
      children,
      ...(after === undefined ? {} : { after }),
    };
    if (!isAppendBlockChildrenParameters(params)) {
      return { error: "Invalid Notion block children" };
    }
    const result = await notion.blocks.children.append(params);
    return {
      appended: result.results.length,
      blocks: result.results.map((b) => ({
        id: b.id,
        type: "type" in b ? b.type : undefined,
      })),
    };
  },
});
