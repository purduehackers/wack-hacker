import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { notion } from "./client.ts";

export const retrieve_block = tool({
  description:
    "Get a single Notion block by ID. Returns block type and its typed content. Use for inspecting individual blocks before updating.",
  inputSchema: z.object({
    block_id: z.string().describe("Block UUID"),
  }),
  execute: async ({ block_id }) => {
    const block = await notion.blocks.retrieve({ block_id });
    return JSON.stringify(block);
  },
});

export const update_block = tool({
  description:
    "Update a block's content. The shape of block_content must match the existing block's type (e.g. { paragraph: { rich_text: [...] } }). Use retrieve_block first to see the current structure.",
  inputSchema: z.object({
    block_id: z.string().describe("Block UUID"),
    block_content: z
      .record(z.string(), z.unknown())
      .describe("Block content in Notion API format, keyed by block type"),
    archived: z.boolean().optional().describe("Set true to archive"),
  }),
  execute: async ({ block_id, block_content, archived }) => {
    const block = await notion.blocks.update({
      block_id,
      ...(block_content as Record<string, unknown>),
      archived,
    } as Parameters<typeof notion.blocks.update>[0]);
    return JSON.stringify(block);
  },
});

export const delete_block = approval(
  tool({
    description:
      "Archive (soft-delete) a block. Notion does not permanently delete blocks — this sets archived=true.",
    inputSchema: z.object({
      block_id: z.string().describe("Block UUID"),
    }),
    execute: async ({ block_id }) => {
      const block = await notion.blocks.delete({ block_id });
      return JSON.stringify({
        id: block.id,
        archived: "archived" in block ? block.archived : true,
      });
    },
  }),
);

export const list_block_children = tool({
  description:
    "List a block's child blocks (for a page or container block). Paginated. Returns each child's ID, type, and summary content.",
  inputSchema: z.object({
    block_id: z.string().describe("Parent block or page UUID"),
    start_cursor: z.string().optional(),
    page_size: z.number().max(100).optional(),
  }),
  execute: async ({ block_id, start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.blocks.children.list({
      block_id,
      start_cursor,
      page_size: page_size ?? 50,
    });
    return JSON.stringify({
      blocks: results.map((b) => ({
        id: b.id,
        type: "type" in b ? b.type : undefined,
        has_children: "has_children" in b ? b.has_children : undefined,
        archived: "archived" in b ? b.archived : undefined,
      })),
      has_more,
      next_cursor,
    });
  },
});

export const append_block_children = tool({
  description:
    "Append blocks to a page or container block. children is an array of block objects in Notion API format (e.g. [{ paragraph: { rich_text: [{ text: { content: 'Hello' } }] } }]).",
  inputSchema: z.object({
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
    const result = await notion.blocks.children.append({
      block_id,
      children: children as Parameters<typeof notion.blocks.children.append>[0]["children"],
      after,
    });
    return JSON.stringify({
      appended: result.results.length,
      blocks: result.results.map((b) => ({
        id: b.id,
        type: "type" in b ? b.type : undefined,
      })),
    });
  },
});
