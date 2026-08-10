import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const delete_reaction = defineTool({
  description: "Remove an emoji reaction from a comment on a Figma file.",
  access: { risk: "destructive" },
  input: z.strictObject({
    file_key: fileKey,
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
