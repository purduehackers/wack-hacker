import type { Comment, GetCommentsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

function summarizeComment(comment: Comment) {
  return {
    id: comment.id,
    message: comment.message,
    author: comment.user.handle,
    createdAt: comment.created_at,
    resolvedAt: comment.resolved_at,
    orderId: comment.order_id,
    parentId: comment.parent_id,
    clientMeta: comment.client_meta,
  };
}

export const list_comments = defineTool({
  description:
    "List comments on a Figma file. Returns comment text, author, timestamp, resolved status, and thread info.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
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
