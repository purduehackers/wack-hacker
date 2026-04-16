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
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { admin } from "../../skills/index.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

/** List members in the Sentry organization. */
export const list_members = tool({
  description:
    "List members in the Sentry organization. Returns name, email, role, pending status, and team slugs.",
  inputSchema: z.object({
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ cursor }) => {
    const result = await listAnOrganization_sMembers({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: { cursor },
    });
    const { data } = unwrapResult(result, "listMembers");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        roleName: m.roleName,
        pending: m.pending,
        expired: m.expired,
        dateCreated: m.dateCreated,
        username: (m.user as Record<string, unknown> | null)?.username,
        teams: m.teams,
      })),
    );
  },
});

/** Get details for a specific organization member. */
export const get_member = tool({
  description: "Get full details for a Sentry organization member by their member ID.",
  inputSchema: z.object({
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
    const d = data as Record<string, unknown>;
    return JSON.stringify({
      id: d.id,
      email: d.email,
      name: d.name,
      role: d.role,
      roleName: d.roleName,
      pending: d.pending,
      expired: d.expired,
      dateCreated: d.dateCreated,
      user: d.user,
      teams: d.teams,
    });
  },
});

/** List teams in the Sentry organization. */
export const list_teams = tool({
  description:
    "List teams in the Sentry organization. Returns slug, name, member count, and date created.",
  inputSchema: z.object({
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ cursor }) => {
    const result = await listAnOrganization_sTeams({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: { cursor },
    });
    const { data } = unwrapResult(result, "listTeams");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((t) => ({
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
export const get_team = tool({
  description: "Get full details for a Sentry team by slug.",
  inputSchema: z.object({
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
export const list_team_members = tool({
  description: "List members of a Sentry team.",
  inputSchema: z.object({
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
      query: { cursor },
    });
    const { data } = unwrapResult(result, "listTeamMembers");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        username: (m.user as Record<string, unknown> | null)?.username,
      })),
    );
  },
});

/** Create a new team. */
export const create_team = admin(
  tool({
    description: "Create a new team in the Sentry organization.",
    inputSchema: z.object({
      name: z.string().describe("Team name"),
      slug: z.string().optional().describe("Team slug (auto-generated from name if omitted)"),
    }),
    execute: async ({ name, slug }) => {
      const result = await createANewTeam({
        ...sentryOpts(),
        path: { organization_id_or_slug: sentryOrg() },
        body: { name, slug },
      });
      const { data } = unwrapResult(result, "createTeam");
      return JSON.stringify(data);
    },
  }),
);

/** Update an existing team. */
export const update_team = admin(
  tool({
    description: "Update a Sentry team's name or slug.",
    inputSchema: z.object({
      team_slug: z.string().describe("Current team slug"),
      name: z.string().optional().describe("New team name"),
      slug: z.string().optional().describe("New team slug"),
    }),
    execute: async ({ team_slug, name, slug }) => {
      const result = await updateATeam({
        ...sentryOpts(),
        path: {
          organization_id_or_slug: sentryOrg(),
          team_id_or_slug: team_slug,
        },
        body: { name, slug: slug ?? team_slug } as Parameters<typeof updateATeam>[0]["body"],
      });
      const { data } = unwrapResult(result, "updateTeam");
      return JSON.stringify(data);
    },
  }),
);

/** Delete a team. */
export const delete_team = admin(
  tool({
    description: "Permanently delete a Sentry team. This action cannot be undone.",
    inputSchema: z.object({
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
  }),
);

/** Add a member to a team. */
export const add_team_member = admin(
  tool({
    description: "Add an organization member to a Sentry team.",
    inputSchema: z.object({
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
  }),
);

/** Remove a member from a team. */
export const remove_team_member = admin(
  tool({
    description: "Remove a member from a Sentry team.",
    inputSchema: z.object({
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
  }),
);
