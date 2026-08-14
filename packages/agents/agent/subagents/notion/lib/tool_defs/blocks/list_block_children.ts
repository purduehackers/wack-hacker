import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { cursorPaginationInputShape } from "../../shared-constants.ts";

export const list_block_children = defineTool({
  description:
    "List a block's child blocks (for a page or container block). Paginated. Returns each child's ID, type, and summary content.",
  access: { risk: "read" },
  input: z.strictObject({
    block_id: z.string().describe("Parent block or page UUID"),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ block_id, start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.blocks.children.list({
      block_id,
      ...(start_cursor !== undefined && { start_cursor }),
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
