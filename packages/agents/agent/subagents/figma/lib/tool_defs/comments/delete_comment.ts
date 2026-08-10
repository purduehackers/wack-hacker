import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const delete_comment = defineTool({
  description: "Delete a comment from a Figma file.",
  access: { risk: "destructive" },
  input: z.strictObject({
    file_key: fileKey,
    comment_id: z.string().describe("The comment ID to delete"),
  }),
  execute: async ({ file_key, comment_id }) => {
    await figma.delete(`/v1/files/${file_key}/comments/${comment_id}`);
    return { deleted: true };
  },
});
