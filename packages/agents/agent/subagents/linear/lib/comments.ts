import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";

export const create_comment = defineTool({
  description:
    "Post a Markdown comment on an issue. Requires the issue's UUID (resolve via search_entities first).",
  access: { risk: "write" },
  input: z.strictObject({ issueId: z.string(), body: z.string() }),
  execute: async (input) => {
    const payload = await linear.createComment(input);
    const comment = await payload.comment;
    if (!comment) return "Failed to create comment";
    return JSON.stringify({ id: comment.id, url: comment.url });
  },
});

export const edit_comment = defineTool({
  description: "Edit an existing comment's body by comment ID. Replaces the full body.",
  access: { risk: "write" },
  input: z.strictObject({ id: z.string(), body: z.string() }),
  execute: async ({ id, body }) => {
    const payload = await linear.updateComment(id, { body });
    const comment = await payload.comment;
    if (!comment) return "Failed to edit comment";
    return JSON.stringify({ id: comment.id, url: comment.url });
  },
});

export const delete_comment = defineTool({
  description: "Delete a comment by ID. Only use when explicitly asked.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string() }),
  execute: async ({ id }) => {
    const payload = await linear.deleteComment(id);
    return JSON.stringify({ success: payload.success });
  },
});
