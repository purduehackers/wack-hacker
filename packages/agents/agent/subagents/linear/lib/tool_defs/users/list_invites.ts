import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const list_invites = defineTool({
  description: "List all pending workspace invites with email, role, who sent it, and expiry date.",
  access: { risk: "read", minRole: "admin" },
  input: z.strictObject({}),
  execute: async () => {
    const r = await linear.organizationInvites();
    const results = await Promise.all(
      r.nodes.map(async (inv) => {
        const inviter = await inv.inviter;
        return {
          id: inv.id,
          email: inv.email,
          role: inv.role,
          inviter: inviter?.name,
          expiresAt: inv.expiresAt,
          accepted: Boolean(inv.acceptedAt),
        };
      }),
    );
    return JSON.stringify(results);
  },
});
