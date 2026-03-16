import type { CreateCommentParameters } from "@notionhq/client/build/src/api-endpoints";

import { tool } from "ai";
import { z } from "zod";

import { notion } from "../client";

export const create_comment = tool({
  description: `Add a comment to a page or reply in an existing discussion thread. For new comments, use parent_type "page_id". For replies, use "discussion_id" (get the ID from list_comments).`,
  inputSchema: z.object({
    parent_type: z.enum(["page_id", "discussion_id"]).describe("Comment target type"),
    parent_id: z.string().describe("Page UUID or discussion thread ID"),
    text: z.string().describe("Comment text (plain text)"),
  }),
  execute: async ({ parent_type, parent_id, text }) => {
    const params =
      parent_type === "page_id"
        ? { parent: { page_id: parent_id }, rich_text: [{ text: { content: text } }] }
        : { discussion_id: parent_id, rich_text: [{ text: { content: text } }] };

    const comment = await notion.comments.create(params as CreateCommentParameters);
    if (!("discussion_id" in comment)) return JSON.stringify({ id: comment.id });
    return JSON.stringify({
      id: comment.id,
      discussion_id: comment.discussion_id,
      created_time: comment.created_time,
    });
  },
});

export const list_comments = tool({
  description: `List comments on a page. Returns comment text, author, timestamp, and discussion thread ID (for replies). Paginated.`,
  inputSchema: z.object({
    block_id: z.string().describe("Page or block UUID"),
    start_cursor: z.string().optional(),
    page_size: z.number().max(100).optional(),
  }),
  execute: async ({ block_id, start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.comments.list({
      block_id,
      start_cursor,
      page_size: page_size ?? 25,
    });
    return JSON.stringify({
      comments: results.map((c) => ({
        id: c.id,
        discussion_id: "discussion_id" in c ? c.discussion_id : undefined,
        text: "rich_text" in c ? c.rich_text.map((t) => t.plain_text).join("") : "",
        created_by: "created_by" in c ? c.created_by.id : undefined,
        created_time: "created_time" in c ? c.created_time : undefined,
      })),
      has_more,
      next_cursor,
    });
  },
});
