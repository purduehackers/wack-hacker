import type { Comment, GetCommentsResponse } from "@figma/rest-api-spec";

import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { figma } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeComment(c: Comment) {
  return {
    id: c.id,
    message: c.message,
    author: c.user.handle,
    createdAt: c.created_at,
    resolvedAt: c.resolved_at,
    orderId: c.order_id,
    parentId: c.parent_id,
    clientMeta: c.client_meta,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_comments = tool({
  description:
    "List comments on a Figma file. Returns comment text, author, timestamp, resolved status, and thread info.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
    as_md: z
      .boolean()
      .default(false)
      .describe("If true, returns comment message as markdown instead of plain text"),
  }),
  execute: async ({ file_key, as_md }) => {
    const data = await figma.get<GetCommentsResponse>(
      `/v1/files/${file_key}/comments${as_md ? "?as_md=true" : ""}`,
    );
    return JSON.stringify(data.comments.map(summarizeComment));
  },
});

export const create_comment = tool({
  description:
    "Post a comment on a Figma file. Can optionally be pinned to a specific location or node.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
    message: z.string().describe("Comment text"),
    comment_id: z.string().optional().describe("Parent comment ID for replies"),
    x: z.number().optional().describe("X coordinate to pin the comment"),
    y: z.number().optional().describe("Y coordinate to pin the comment"),
    node_id: z.string().optional().describe("Node ID to attach the comment to"),
  }),
  execute: async ({ file_key, message, comment_id, x, y, node_id }) => {
    const body: Record<string, unknown> = { message };
    if (comment_id) body.comment_id = comment_id;
    if (x !== undefined && y !== undefined) {
      body.client_meta = { x, y, ...(node_id ? { node_id } : {}) };
    } else if (node_id) {
      body.client_meta = { node_id, node_offset: { x: 0, y: 0 } };
    }
    const result = await figma.post<Comment>(`/v1/files/${file_key}/comments`, body);
    return JSON.stringify(result);
  },
});

export const delete_comment = approval(
  tool({
    description: "Delete a comment from a Figma file.",
    inputSchema: z.object({
      file_key: z.string().describe("The file key"),
      comment_id: z.string().describe("The comment ID to delete"),
    }),
    execute: async ({ file_key, comment_id }) => {
      await figma.delete(`/v1/files/${file_key}/comments/${comment_id}`);
      return JSON.stringify({ deleted: true });
    },
  }),
);

export const add_reaction = tool({
  description: "Add an emoji reaction to a comment on a Figma file.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
    comment_id: z.string().describe("The comment ID"),
    emoji: z.string().describe('Emoji shortcode (e.g., ":thumbsup:", ":heart:")'),
  }),
  execute: async ({ file_key, comment_id, emoji }) => {
    await figma.post(`/v1/files/${file_key}/comments/${comment_id}/reactions`, { emoji });
    return JSON.stringify({ success: true });
  },
});

export const delete_reaction = approval(
  tool({
    description: "Remove an emoji reaction from a comment on a Figma file.",
    inputSchema: z.object({
      file_key: z.string().describe("The file key"),
      comment_id: z.string().describe("The comment ID"),
      emoji: z.string().describe("Emoji shortcode to remove"),
    }),
    execute: async ({ file_key, comment_id, emoji }) => {
      await figma.delete(
        `/v1/files/${file_key}/comments/${comment_id}/reactions?emoji=${encodeURIComponent(emoji)}`,
      );
      return JSON.stringify({ deleted: true });
    },
  }),
);
