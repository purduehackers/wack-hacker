import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const delete_comment = defineTool({
  description: "Delete a comment by ID. Only use when explicitly asked.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string() }),
  execute: async ({ id }) => {
    const payload = await linear.deleteComment(id);
    return JSON.stringify({ success: payload.success });
  },
});
