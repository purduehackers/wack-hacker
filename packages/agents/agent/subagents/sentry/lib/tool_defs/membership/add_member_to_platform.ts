import { addAMemberToAnOrganization, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

/**
 * Sentry returns `role`, but the generated response type omits it.
 * `.catch` keeps the "can never fail" property the previous `z.unknown()` had.
 * A throwing `.parse` reads this projection, so a shape `z.json()` rejects
 * must degrade to "absent" rather than fail the invite.
 */
const invitedMemberProjectionSchema = z.looseObject({
  role: z.json().optional().catch(undefined),
});

export const add_member_to_platform = defineTool({
  description:
    "Invite a new member to the Sentry organization by email. Role defaults to 'member'; other roles include 'admin', 'manager', 'owner', 'billing'. Optionally assign to teams by slug. Never fabricate emails — confirm the exact address first.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    email: z.email().describe("Email to invite"),
    role: z
      .enum(["owner", "manager", "admin", "member", "billing"])
      .optional()
      .describe("Organization role (default: member)"),
    team_roles: z
      .array(
        z.strictObject({
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
          // oxlint-disable-next-line unicorn/no-null -- Sentry uses null for no team role
          role: t.role ?? null,
        })),
      },
    });
    const { data } = unwrapResult(result, "addMember");
    const d = invitedMemberProjectionSchema.parse(data);
    return JSON.stringify({
      id: data.id,
      email: data.email,
      role: d.role,
      pending: data.pending,
    });
  },
});
