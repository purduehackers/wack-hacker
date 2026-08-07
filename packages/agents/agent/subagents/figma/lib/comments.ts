import type { Comment, GetCommentsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
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

export const list_comments = defineTool({
  description:
    "List comments on a Figma file. Returns comment text, author, timestamp, resolved status, and thread info.",
  access: { risk: "read" },
  input: z.object({
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
    return data.comments.map(summarizeComment);
  },
});

export const create_comment = defineTool({
  description:
    "Post a comment on a Figma file. Can optionally be pinned to a specific location or node.",
  access: { risk: "write" },
  input: z.object({
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
    return await figma.post<Comment>(`/v1/files/${file_key}/comments`, body);
  },
});

export const delete_comment = defineTool({
  description: "Delete a comment from a Figma file.",
  access: { risk: "destructive" },
  input: z.object({
    file_key: z.string().describe("The file key"),
    comment_id: z.string().describe("The comment ID to delete"),
  }),
  execute: async ({ file_key, comment_id }) => {
    await figma.delete(`/v1/files/${file_key}/comments/${comment_id}`);
    return { deleted: true };
  },
});

export const add_reaction = defineTool({
  description: "Add an emoji reaction to a comment on a Figma file.",
  access: { risk: "write" },
  input: z.object({
    file_key: z.string().describe("The file key"),
    comment_id: z.string().describe("The comment ID"),
    emoji: z.string().describe('Emoji shortcode (e.g., ":thumbsup:", ":heart:")'),
  }),
  execute: async ({ file_key, comment_id, emoji }) => {
    await figma.post(`/v1/files/${file_key}/comments/${comment_id}/reactions`, { emoji });
    return { success: true };
  },
});

export const delete_reaction = defineTool({
  description: "Remove an emoji reaction from a comment on a Figma file.",
  access: { risk: "destructive" },
  input: z.object({
    file_key: z.string().describe("The file key"),
    comment_id: z.string().describe("The comment ID"),
    emoji: z.string().describe("Emoji shortcode to remove"),
  }),
  execute: async ({ file_key, comment_id, emoji }) => {
    await figma.delete(
      `/v1/files/${file_key}/comments/${comment_id}/reactions?emoji=${encodeURIComponent(emoji)}`,
    );
    return { deleted: true };
  },
});
