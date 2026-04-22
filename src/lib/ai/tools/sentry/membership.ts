import { addAMemberToAnOrganization, deleteAnOrganizationMember, unwrapResult } from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { admin } from "../../skills/index.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

export const add_member_to_platform = admin(
  approval(
    tool({
      description:
        "Invite a new member to the Sentry organization by email. Role defaults to 'member'; other roles include 'admin', 'manager', 'owner', 'billing'. Optionally assign to teams by slug. Never fabricate emails — confirm the exact address first.",
      inputSchema: z.object({
        email: z.email().describe("Email to invite"),
        role: z
          .enum(["owner", "manager", "admin", "member", "billing"])
          .optional()
          .describe("Organization role (default: member)"),
        team_roles: z
          .array(
            z.object({
              team_slug: z.string(),
              role: z.string().nullable().optional(),
            }),
          )
          .optional()
          .describe("Per-team role assignments for this member"),
      }),
      execute: async ({ email, role, team_roles }) => {
        const result = await addAMemberToAnOrganization({
          ...sentryOpts(),
          path: { organization_id_or_slug: sentryOrg() },
          body: {
            email,
            orgRole: role ?? "member",
            teamRoles: (team_roles ?? []).map((t) => ({
              teamSlug: t.team_slug,
              role: (t.role ?? null) as never,
            })),
          } as Parameters<typeof addAMemberToAnOrganization>[0]["body"],
        });
        const { data } = unwrapResult(result, "addMember");
        const d = data as Record<string, unknown>;
        return JSON.stringify({
          id: d.id,
          email: d.email,
          role: d.role,
          pending: d.pending,
        });
      },
    }),
  ),
);

export const remove_member_from_platform = admin(
  approval(
    tool({
      description:
        "Remove a member from the Sentry organization by their member ID. Resolve the member ID via list_members first — never remove on ambiguous input.",
      inputSchema: z.object({
        member_id: z.string().describe("Sentry member ID (not the user's email)"),
      }),
      execute: async ({ member_id }) => {
        const result = await deleteAnOrganizationMember({
          ...sentryOpts(),
          path: {
            organization_id_or_slug: sentryOrg(),
            member_id,
          },
        });
        unwrapResult(result, "removeMember");
        return JSON.stringify({ removed: true, member_id });
      },
    }),
  ),
);
