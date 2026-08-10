import type { Comment, PostCommentRequestBody } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const create_comment = defineTool({
  description:
    "Post a comment on a Figma file. Can optionally be pinned to a specific location or node.",
  access: { risk: "write" },
  input: z.strictObject({
    file_key: fileKey,
    message: z.string().describe("Comment text"),
    comment_id: z.string().optional().describe("Parent comment ID for replies"),
    x: z.number().optional().describe("X coordinate to pin the comment"),
    y: z.number().optional().describe("Y coordinate to pin the comment"),
    node_id: z.string().optional().describe("Node ID to attach the comment to"),
  }),
  execute: async ({ file_key, message, comment_id, x, y, node_id }) => {
    const body: PostCommentRequestBody = { message };
    if (comment_id) body.comment_id = comment_id;
    if (x !== undefined && y !== undefined) {
      body.client_meta = { x, y, ...(node_id ? { node_id } : {}) };
    } else if (node_id) {
      body.client_meta = { node_id, node_offset: { x: 0, y: 0 } };
    }
    return await figma.post<Comment>(`/v1/files/${file_key}/comments`, body);
  },
});
