import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const unsuspend_user = defineTool({
  description: "Restore a suspended user's access.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    id: z.string().describe("User UUID to unsuspend"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    const payload = await u.unsuspend();
    return JSON.stringify({ success: payload.success });
  },
});
