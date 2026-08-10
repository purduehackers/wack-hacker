import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";
import { cursorPaginationInputShape } from "./shared-constants.ts";

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
