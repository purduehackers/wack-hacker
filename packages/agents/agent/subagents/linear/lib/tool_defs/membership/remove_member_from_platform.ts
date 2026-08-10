import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const remove_member_from_platform = defineTool({
  description:
    "Remove a member from the Linear workspace. If the user has not yet accepted their invite, revokes the pending invite. If they have joined, suspends them (data is preserved; they lose access). Provide either email (for pending invites) or user_id (for active users). Always confirm identity before calling.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    email: z
      .email()
      .optional()
      .describe("Email on the pending invite to revoke (mutually exclusive with user_id)"),
    user_id: z
      .string()
      .optional()
      .describe("Active user's UUID to suspend (mutually exclusive with email)"),
  }),
  execute: async ({ email, user_id }) => {
    if (!email && !user_id) {
      return JSON.stringify({ error: "Provide either email or user_id" });
    }
    if (email) {
      const invites = await linear.organizationInvites();
      const match = invites.nodes.find((inv) => inv.email === email);
      if (!match) return JSON.stringify({ error: `No pending invite found for ${email}` });
      const payload = await linear.deleteOrganizationInvite(match.id);
      return JSON.stringify({ revoked_invite: payload.success, email });
    }
    if (user_id === undefined) return JSON.stringify({ error: "Provide either email or user_id" });
    const user = await linear.user(user_id);
    const payload = await user.suspend();
    return JSON.stringify({ suspended: payload.success, user_id });
  },
});
