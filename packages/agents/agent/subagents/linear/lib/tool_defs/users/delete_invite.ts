import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const delete_invite = defineTool({
  description: "Revoke a pending invite by ID. Use list_invites first to find the ID.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    id: z.string().describe("Invite UUID to revoke"),
  }),
  execute: async ({ id }) => {
    const payload = await linear.deleteOrganizationInvite(id);
    return JSON.stringify({ success: payload.success });
  },
});
