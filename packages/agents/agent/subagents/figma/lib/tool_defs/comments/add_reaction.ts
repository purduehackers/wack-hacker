import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const add_reaction = defineTool({
  description: "Add an emoji reaction to a comment on a Figma file.",
  access: { risk: "write" },
  input: z.strictObject({
    file_key: fileKey,
    comment_id: z.string().describe("The comment ID"),
    emoji: z.string().describe('Emoji shortcode (e.g., ":thumbsup:", ":heart:")'),
  }),
  execute: async ({ file_key, comment_id, emoji }) => {
    await figma.post(`/v1/files/${file_key}/comments/${comment_id}/reactions`, { emoji });
    return { success: true };
  },
});
