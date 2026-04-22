import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { admin } from "../../skills/index.ts";
import { linear } from "./client.ts";

export const add_member_to_platform = admin(
  approval(
    tool({
      description:
        "Send a Linear workspace invite by email. Role defaults to 'member'; can also invite as 'admin' or 'guest' (guest users only see teams they're explicitly added to). Never guess or fabricate an email — always confirm the exact address with the user.",
      inputSchema: z.object({
        email: z.email().describe("Email address to invite"),
        role: z
          .enum(["admin", "member", "guest"])
          .optional()
          .describe("Role for the invitee (default: member)"),
      }),
      execute: async ({ email, role }) => {
        const payload = await linear.createOrganizationInvite({
          email,
          role: (role ?? "member") as never,
        });
        const invite = await payload.organizationInvite;
        if (!invite) return JSON.stringify({ error: "Failed to send invite" });
        return JSON.stringify({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
        });
      },
    }),
  ),
);

export const remove_member_from_platform = admin(
  approval(
    tool({
      description:
        "Remove a member from the Linear workspace. If the user has not yet accepted their invite, revokes the pending invite. If they have joined, suspends them (data is preserved; they lose access). Provide either email (for pending invites) or user_id (for active users). Always confirm identity before calling.",
      inputSchema: z.object({
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
        const user = await linear.user(user_id as string);
        const payload = await user.suspend();
        return JSON.stringify({ suspended: payload.success, user_id });
      },
    }),
  ),
);
