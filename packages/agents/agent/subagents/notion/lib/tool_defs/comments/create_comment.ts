import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const create_comment = defineTool({
  description: `Add a comment to a page or reply in an existing discussion thread. For new comments, use parent_type "page_id". For replies, use "discussion_id" (get the ID from list_comments).`,
  access: { risk: "write" },
  input: z.strictObject({
    parent_type: z.enum(["page_id", "discussion_id"]).describe("Comment target type"),
    parent_id: z.string().describe("Parent page UUID or discussion thread ID"),
    text: z.string().describe("Comment text (plain text)"),
  }),
  execute: async ({ parent_type, parent_id, text }) => {
    const params =
      parent_type === "page_id"
        ? { parent: { page_id: parent_id }, rich_text: [{ text: { content: text } }] }
        : { discussion_id: parent_id, rich_text: [{ text: { content: text } }] };

    const comment = await notion.comments.create(params);
    if (!("discussion_id" in comment)) return { id: comment.id };
    return {
      id: comment.id,
      discussion_id: comment.discussion_id,
      created_time: comment.created_time,
    };
  },
});
