import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const retrieve_comment = defineTool({
  description:
    "Get a single Notion comment by ID. Returns text, author, discussion thread ID, and timestamp.",
  access: { risk: "read" },
  input: z.strictObject({
    comment_id: z.string().describe("Comment UUID"),
  }),
  execute: async ({ comment_id }) => {
    const c = await notion.comments.retrieve({ comment_id });
    return {
      id: c.id,
      discussion_id: "discussion_id" in c ? c.discussion_id : undefined,
      text: "rich_text" in c ? c.rich_text.map((t) => t.plain_text).join("") : "",
      created_by: "created_by" in c ? c.created_by.id : undefined,
      created_time: "created_time" in c ? c.created_time : undefined,
    };
  },
});
