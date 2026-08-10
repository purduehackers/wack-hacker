import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

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
