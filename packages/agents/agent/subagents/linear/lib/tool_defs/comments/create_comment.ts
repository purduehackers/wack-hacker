import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

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
