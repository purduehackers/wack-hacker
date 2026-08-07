import { UserRoleType } from "@linear/sdk";
import { z } from "zod";

const INVITE_ROLE: Record<"admin" | "member" | "guest", UserRoleType> = {
  admin: UserRoleType.Admin,
  member: UserRoleType.User,
  guest: UserRoleType.Guest,
};

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";

export const list_users = defineTool({
  description:
    "List all workspace members. Returns name, display name, email, role flags (admin/owner/guest), active status, and profile URL.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const r = await linear.users();
    return JSON.stringify(
      r.nodes.map((u) => ({
        id: u.id,
        name: u.name,
        displayName: u.displayName,
        email: u.email,
        admin: u.admin,
        owner: u.owner,
        guest: u.guest,
        active: u.active,
        url: u.url,
      })),
    );
  },
});

export const get_user = defineTool({
  description:
    "Get a user's full profile by ID — name, email, display name, roles, timezone, current status, issue count, and profile URL.",
  access: { risk: "read" },
  input: z.object({
    id: z.string().describe("User UUID"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    return JSON.stringify({
      id: u.id,
      name: u.name,
      displayName: u.displayName,
      email: u.email,
      admin: u.admin,
      owner: u.owner,
      guest: u.guest,
      active: u.active,
      timezone: u.timezone,
      statusEmoji: u.statusEmoji,
      statusLabel: u.statusLabel,
      createdIssueCount: u.createdIssueCount,
      url: u.url,
    });
  },
});

export const get_user_teams = defineTool({
  description: "List the teams a user belongs to. Returns team ID, name, and key.",
  access: { risk: "read" },
  input: z.object({
    id: z.string().describe("User UUID"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    const teams = await u.teams();
    return JSON.stringify(teams.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key })));
  },
});

export const get_user_assigned_issues = defineTool({
  description:
    "List open issues assigned to a user. Returns identifier, title, priority, state, and URL. Use for 'what's X working on?' or 'show my issues'.",
  access: { risk: "read" },
  input: z.object({
    id: z.string().describe("User UUID"),
    first: z.number().optional().default(25).describe("Max results (default 25)"),
  }),
  execute: async ({ id, first }) => {
    const u = await linear.user(id);
    const issues = await u.assignedIssues({ first });
    const results = await Promise.all(
      issues.nodes.map(async (i) => {
        const state = await i.state;
        return {
          id: i.id,
          identifier: i.identifier,
          title: i.title,
          priority: i.priorityLabel,
          state: state?.name,
          url: i.url,
        };
      }),
    );
    return JSON.stringify(results);
  },
});

export const suspend_user = defineTool({
  description:
    "Suspend a user, disabling their access. Data is preserved. Resolve user identity first — never suspend on ambiguous input.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    id: z.string().describe("User UUID to suspend"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    const payload = await u.suspend();
    return JSON.stringify({ success: payload.success });
  },
});

export const unsuspend_user = defineTool({
  description: "Restore a suspended user's access.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    id: z.string().describe("User UUID to unsuspend"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    const payload = await u.unsuspend();
    return JSON.stringify({ success: payload.success });
  },
});

export const invite_user = defineTool({
  description:
    "Send a workspace invite by email. Role can be admin, member (default), or guest. Guest users only see teams they're explicitly added to.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    email: z.string().describe("Email address to invite"),
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

export const list_invites = defineTool({
  description: "List all pending workspace invites with email, role, who sent it, and expiry date.",
  access: { risk: "read", minRole: "admin" },
  input: z.object({}),
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

export const delete_invite = defineTool({
  description: "Revoke a pending invite by ID. Use list_invites first to find the ID.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    id: z.string().describe("Invite UUID to revoke"),
  }),
  execute: async ({ id }) => {
    const payload = await linear.deleteOrganizationInvite(id);
    return JSON.stringify({ success: payload.success });
  },
});
