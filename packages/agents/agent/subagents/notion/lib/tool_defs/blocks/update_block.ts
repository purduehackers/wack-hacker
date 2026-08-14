import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { isUpdateBlockParameters } from "../../notion-input.ts";

export const update_block = defineTool({
  description:
    "Update a block's content. The shape of block_content must match the existing block's type (e.g. { paragraph: { rich_text: [...] } }). Use retrieve_block first to see the current structure.",
  access: { risk: "destructive" },
  input: z.strictObject({
    block_id: z.string().describe("Block UUID"),
    block_content: z
      .record(z.string(), z.json())
      .describe("Block content in Notion API format, keyed by block type"),
    archived: z.boolean().optional().describe("Set true to archive"),
  }),
  execute: async ({ block_id, block_content, archived }) => {
    const params = {
      block_id,
      ...block_content,
      ...(archived !== undefined && { in_trash: archived }),
    };
    if (!isUpdateBlockParameters(params)) {
      return { error: "Invalid Notion block update content" };
    }
    return await notion.blocks.update(params);
  },
});
