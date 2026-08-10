import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const suspend_user = defineTool({
  description:
    "Suspend a user, disabling their access. Data is preserved. Resolve user identity first — never suspend on ambiguous input.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    id: z.string().describe("User UUID to suspend"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    const payload = await u.suspend();
    return JSON.stringify({ success: payload.success });
  },
});
