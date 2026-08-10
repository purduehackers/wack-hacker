import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { INVITE_ROLE } from "../../constants.ts";

export const invite_user = defineTool({
  description:
    "Send a workspace invite by email. Role can be admin, member (default), or guest. Guest users only see teams they're explicitly added to.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    email: z.email().describe("Email address to invite"),
    role: z
      .enum(["admin", "member", "guest"])
      .optional()
      .describe("Role for the invitee (default: member)"),
  }),
  execute: async ({ email, role }) => {
    const payload = await linear.createOrganizationInvite({
      email,
      role: INVITE_ROLE[role ?? "member"],
    });
    const invite = await payload.organizationInvite;
    if (!invite) return "Failed to send invite";
    return JSON.stringify({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    });
  },
});
