import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { isAppendBlockChildrenParameters } from "../../notion-input.ts";

export const append_block_children = defineTool({
  description:
    "Append blocks to a page or container block. children is an array of block objects in Notion API format (e.g. [{ paragraph: { rich_text: [{ text: { content: 'Hello' } }] } }]).",
  access: { risk: "write" },
  input: z.strictObject({
    block_id: z.string().describe("Parent block or page UUID"),
    children: z
      .array(z.record(z.string(), z.json()))
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
