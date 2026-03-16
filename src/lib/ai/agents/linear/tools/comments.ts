import { tool } from "ai";
import { z } from "zod";

import { linear } from "../client";

export const create_comment = tool({
  description:
    "Post a Markdown comment on an issue. Requires the issue's UUID (resolve via search_entities first).",
  inputSchema: z.object({ issueId: z.string(), body: z.string() }),
  execute: async (input) => {
    const payload = await linear.createComment(input);
    const comment = await payload.comment;
    if (!comment) return "Failed to create comment";
    return JSON.stringify({ id: comment.id, url: comment.url });
  },
});

export const edit_comment = tool({
  description: "Edit an existing comment's body by comment ID. Replaces the full body.",
  inputSchema: z.object({ id: z.string(), body: z.string() }),
  execute: async ({ id, body }) => {
    const payload = await linear.updateComment(id, { body });
    const comment = await payload.comment;
    if (!comment) return "Failed to edit comment";
    return JSON.stringify({ id: comment.id, url: comment.url });
  },
});

export const delete_comment = tool({
  description: "Delete a comment by ID. Only use when explicitly asked.",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const payload = await linear.deleteComment(id);
    return JSON.stringify({ success: payload.success });
  },
});
