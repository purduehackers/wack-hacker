import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const delete_broadcast = defineTool({
  description: "Delete a Resend broadcast. Cannot delete a broadcast that has been sent.",
  access: { risk: "destructive" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    broadcast_id: z.string().describe("Resend broadcast ID"),
  }),
  execute: async ({ broadcast_id }) => {
    const result = await resend().broadcasts.remove(broadcast_id);
    if (result.error) return { error: result.error.message };
    return { deleted: true, broadcast_id };
  },
});
