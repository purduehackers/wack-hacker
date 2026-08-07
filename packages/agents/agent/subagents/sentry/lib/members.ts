import {
  listAnOrganization_sMembers,
  retrieveAnOrganizationMember,
  listAnOrganization_sTeams,
  retrieveATeam,
  listATeam_sMembers,
  createANewTeam,
  updateATeam,
  deleteATeam,
  addAnOrganizationMemberToATeam,
  deleteAnOrganizationMemberFromATeam,
  updateAnOrganizationMember_sRoles,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

const memberProjectionSchema = z.looseObject({
  role: z.string().nullish(),
  roleName: z.string().nullish(),
  teams: z.array(z.unknown()).nullish(),
});
const updateTeamBodySchema = z.object({ name: z.string().optional(), slug: z.string() });

/** List members in the Sentry organization. */
export const list_members = defineTool({
  description:
    "List members in the Sentry organization. Returns name, email, role, pending status, and team slugs.",
  access: { risk: "read" },
  input: z.object({
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ cursor }) => {
    const result = await listAnOrganization_sMembers({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listMembers");
    return JSON.stringify(
      data.map((member) => {
        const projection = memberProjectionSchema.parse(member);
        return {
          id: member.id,
          email: member.email,
          name: member.name,
          role: projection.role,
          roleName: projection.roleName,
          pending: member.pending,
          expired: member.expired,
          dateCreated: member.dateCreated,
          username: member.user?.username,
          teams: projection.teams,
        };
      }),
    );
  },
});

/** Get details for a specific organization member. */
export const get_member = defineTool({
  description: "Get full details for a Sentry organization member by their member ID.",
  access: { risk: "read" },
  input: z.object({
    member_id: z.string().describe("Member ID"),
  }),
  execute: async ({ member_id }) => {
    const result = await retrieveAnOrganizationMember({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
      },
    });
    const { data } = unwrapResult(result, "getMember");
    const d = data;
    const projection = memberProjectionSchema.parse(data);
    return JSON.stringify({
      id: d.id,
      email: d.email,
      name: d.name,
      role: projection.role,
      roleName: projection.roleName,
      pending: d.pending,
      expired: d.expired,
      dateCreated: d.dateCreated,
      user: d.user,
      teams: projection.teams,
    });
  },
});

/** List teams in the Sentry organization. */
export const list_teams = defineTool({
  description:
    "List teams in the Sentry organization. Returns slug, name, member count, and date created.",
  access: { risk: "read" },
  input: z.object({
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ cursor }) => {
    const result = await listAnOrganization_sTeams({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listTeams");
    return JSON.stringify(
      data.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        dateCreated: t.dateCreated,
        memberCount: t.memberCount,
      })),
    );
  },
});

/** Get details for a specific team. */
export const get_team = defineTool({
  description: "Get full details for a Sentry team by slug.",
  access: { risk: "read" },
  input: z.object({
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ team_slug }) => {
    const result = await retrieveATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
    });
    const { data } = unwrapResult(result, "getTeam");
    return JSON.stringify(data);
  },
});

/** List members of a specific team. */
export const list_team_members = defineTool({
  description: "List members of a Sentry team.",
  access: { risk: "read" },
  input: z.object({
    team_slug: z.string().describe("Team slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ team_slug, cursor }) => {
    const result = await listATeam_sMembers({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listTeamMembers");
    return JSON.stringify(
      data.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        username: m.user?.username,
      })),
    );
  },
});

/** Create a new team. */
export const create_team = defineTool({
  description: "Create a new team in the Sentry organization.",
  access: { risk: "write", minRole: "admin" },
  input: z.object({
    name: z.string().describe("Team name"),
    slug: z.string().optional().describe("Team slug (auto-generated from name if omitted)"),
  }),
  execute: async ({ name, slug }) => {
    const result = await createANewTeam({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      body: { name, ...(slug === undefined ? {} : { slug }) },
    });
    const { data } = unwrapResult(result, "createTeam");
    return JSON.stringify(data);
  },
});

/** Update an existing team. */
export const update_team = defineTool({
  description: "Update a Sentry team's name or slug.",
  access: { risk: "write", minRole: "admin" },
  input: z.object({
    team_slug: z.string().describe("Current team slug"),
    name: z.string().optional().describe("New team name"),
    slug: z.string().optional().describe("New team slug"),
  }),
  execute: async ({ team_slug, name, slug }) => {
    const body = updateTeamBodySchema.parse({ name, slug: slug ?? team_slug });
    const result = await updateATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
      body,
    });
    const { data } = unwrapResult(result, "updateTeam");
    return JSON.stringify(data);
  },
});

/** Delete a team. */
export const delete_team = defineTool({
  description: "Permanently delete a Sentry team. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ team_slug }) => {
    const result = await deleteATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
    });
    unwrapResult(result, "deleteTeam");
    return JSON.stringify({ deleted: true });
  },
});

/** Add a member to a team. */
export const add_team_member = defineTool({
  description: "Add an organization member to a Sentry team.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    member_id: z.string().describe("Organization member ID"),
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ member_id, team_slug }) => {
    const result = await addAnOrganizationMemberToATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
        team_id_or_slug: team_slug,
      },
    });
    const { data } = unwrapResult(result, "addTeamMember");
    return JSON.stringify(data);
  },
});

/** Remove a member from a team. */
export const remove_team_member = defineTool({
  description: "Remove a member from a Sentry team.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    member_id: z.string().describe("Organization member ID"),
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ member_id, team_slug }) => {
    const result = await deleteAnOrganizationMemberFromATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
        team_id_or_slug: team_slug,
      },
    });
    unwrapResult(result, "removeTeamMember");
    return JSON.stringify({ removed: true });
  },
});

/** Update a member's organization role. */
export const update_member_role = defineTool({
  description:
    "Update a Sentry organization member's role. Common roles: owner, manager, admin, member, billing.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    member_id: z.string().describe("Organization member ID"),
    role: z
      .enum(["owner", "manager", "admin", "member", "billing"])
      .describe("New organization role"),
  }),
  execute: async ({ member_id, role }) => {
    const result = await updateAnOrganizationMember_sRoles({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
      },
      body: { orgRole: role },
    });
    const { data } = unwrapResult(result, "updateMemberRole");
    return JSON.stringify(data);
  },
});
