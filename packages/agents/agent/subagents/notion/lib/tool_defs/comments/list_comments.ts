import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { cursorPaginationInputShape } from "../../shared-constants.ts";

export const list_comments = defineTool({
  description: `List comments on a page. Returns comment text, author, timestamp, and discussion thread ID (for replies). Paginated.`,
  access: { risk: "read" },
  input: z.strictObject({
    block_id: z.string().describe("Page or block UUID"),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ block_id, start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.comments.list({
      block_id,
      ...(start_cursor === undefined ? {} : { start_cursor }),
      page_size: page_size ?? 25,
    });
    return {
      comments: results.map((c) => ({
        id: c.id,
        discussion_id: "discussion_id" in c ? c.discussion_id : undefined,
        text: "rich_text" in c ? c.rich_text.map((t) => t.plain_text).join("") : "",
        created_by: "created_by" in c ? c.created_by.id : undefined,
        created_time: "created_time" in c ? c.created_time : undefined,
      })),
      has_more,
      next_cursor,
    };
  },
});
