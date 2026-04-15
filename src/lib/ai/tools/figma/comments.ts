import { tool } from "ai";
import { z } from "zod";

import { figmaFetch, figmaFileUrl } from "./client.ts";

export const list_file_comments = tool({
  description: `List all comments on a Figma file. Returns comment text, author, timestamp, resolved status, and pinned node (if any). Comments are ordered newest-first.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
  }),
  execute: async ({ file_key }) => {
    const data = await figmaFetch<{
      comments: Array<{
        id: string;
        message: string;
        created_at: string;
        resolved_at: string | null;
        user: { handle: string; id: string };
        client_meta: { node_id?: string; node_offset?: unknown } | null;
        parent_id: string;
        order_id: string;
      }>;
    }>(`/files/${file_key}/comments`);
    return JSON.stringify({
      file_url: figmaFileUrl(file_key),
      comments: data.comments.map((c) => ({
        id: c.id,
        message: c.message,
        author: c.user.handle,
        created_at: c.created_at,
        resolved: !!c.resolved_at,
        parent_id: c.parent_id || null,
        node_id: c.client_meta?.node_id ?? null,
      })),
    });
  },
});

export const post_file_comment = tool({
  description: `Post a comment on a Figma file. Can optionally pin it to a specific node or reply to an existing comment thread.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
    message: z.string().describe("Comment text"),
    comment_id: z
      .string()
      .optional()
      .describe("Parent comment ID to reply to (for threaded replies)"),
    node_id: z.string().optional().describe("Node ID to pin the comment to"),
  }),
  execute: async ({ file_key, message, comment_id, node_id }) => {
    const body: Record<string, unknown> = { message };
    if (comment_id) body.comment_id = comment_id;
    if (node_id) body.client_meta = { node_id, node_offset: { x: 0, y: 0 } };

    const data = await figmaFetch<{
      id: string;
      message: string;
      created_at: string;
      user: { handle: string };
    }>(`/files/${file_key}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return JSON.stringify({
      id: data.id,
      message: data.message,
      author: data.user.handle,
      created_at: data.created_at,
      file_url: figmaFileUrl(file_key),
    });
  },
});
