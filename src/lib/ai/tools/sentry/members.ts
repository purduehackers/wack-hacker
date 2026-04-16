import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryMutate, sentryOrg } from "./client.ts";

interface SentryMember {
  id: string;
  email: string;
  name: string;
  role: string;
  roleName: string;
  pending: boolean;
  expired: boolean;
  dateCreated: string;
  user: { id: string; username: string; name: string; avatarUrl: string } | null;
  teams: string[];
}

interface SentryTeam {
  id: string;
  slug: string;
  name: string;
  dateCreated: string;
  memberCount: number;
  hasAccess: boolean;
}

interface SentryTeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  user: { id: string; username: string; name: string } | null;
}

/** List members in the Sentry organization. */
export const list_members = tool({
  description:
    "List members in the Sentry organization. Returns name, email, role, pending status, and team slugs.",
  inputSchema: z.object({
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ per_page, cursor }) => {
    const params = new URLSearchParams();
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryMember[]>(
      `/organizations/${sentryOrg()}/members/?${params}`,
    );
    return JSON.stringify(
      data.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        roleName: m.roleName,
        pending: m.pending,
        expired: m.expired,
        dateCreated: m.dateCreated,
        username: m.user?.username,
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
    const data = await sentryGet<SentryMember>(
      `/organizations/${sentryOrg()}/members/${member_id}/`,
    );
    return JSON.stringify({
      id: data.id,
      email: data.email,
      name: data.name,
      role: data.role,
      roleName: data.roleName,
      pending: data.pending,
      expired: data.expired,
      dateCreated: data.dateCreated,
      user: data.user,
      teams: data.teams,
    });
  },
});

/** List teams in the Sentry organization. */
export const list_teams = tool({
  description:
    "List teams in the Sentry organization. Returns slug, name, member count, and date created.",
  inputSchema: z.object({
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ per_page, cursor }) => {
    const params = new URLSearchParams();
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryTeam[]>(`/organizations/${sentryOrg()}/teams/?${params}`);
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
export const get_team = tool({
  description: "Get full details for a Sentry team by slug.",
  inputSchema: z.object({
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ team_slug }) => {
    const data = await sentryGet<SentryTeam>(`/teams/${sentryOrg()}/${team_slug}/`);
    return JSON.stringify(data);
  },
});

/** List members of a specific team. */
export const list_team_members = tool({
  description: "List members of a Sentry team.",
  inputSchema: z.object({
    team_slug: z.string().describe("Team slug"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ team_slug, per_page, cursor }) => {
    const params = new URLSearchParams();
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryTeamMember[]>(
      `/teams/${sentryOrg()}/${team_slug}/members/?${params}`,
    );
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
export const create_team = tool({
  description: "Create a new team in the Sentry organization.",
  inputSchema: z.object({
    name: z.string().describe("Team name"),
    slug: z.string().optional().describe("Team slug (auto-generated from name if omitted)"),
  }),
  execute: async ({ name, slug }) => {
    const data = await sentryMutate(`/organizations/${sentryOrg()}/teams/`, "POST", { name, slug });
    return JSON.stringify(data);
  },
});

/** Update an existing team. */
export const update_team = tool({
  description: "Update a Sentry team's name or slug.",
  inputSchema: z.object({
    team_slug: z.string().describe("Current team slug"),
    name: z.string().optional().describe("New team name"),
    slug: z.string().optional().describe("New team slug"),
  }),
  execute: async ({ team_slug, name, slug }) => {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (slug !== undefined) body.slug = slug;
    const data = await sentryMutate(`/teams/${sentryOrg()}/${team_slug}/`, "PUT", body);
    return JSON.stringify(data);
  },
});

/** Delete a team. */
export const delete_team = tool({
  description: "Permanently delete a Sentry team. This action cannot be undone.",
  inputSchema: z.object({
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ team_slug }) => {
    await sentryMutate(`/teams/${sentryOrg()}/${team_slug}/`, "DELETE");
    return JSON.stringify({ deleted: true });
  },
});

/** Add a member to a team. */
export const add_team_member = tool({
  description: "Add an organization member to a Sentry team.",
  inputSchema: z.object({
    member_id: z.string().describe("Organization member ID"),
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ member_id, team_slug }) => {
    const data = await sentryMutate(
      `/organizations/${sentryOrg()}/members/${member_id}/teams/${team_slug}/`,
      "POST",
    );
    return JSON.stringify(data);
  },
});

/** Remove a member from a team. */
export const remove_team_member = tool({
  description: "Remove a member from a Sentry team.",
  inputSchema: z.object({
    member_id: z.string().describe("Organization member ID"),
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ member_id, team_slug }) => {
    await sentryMutate(
      `/organizations/${sentryOrg()}/members/${member_id}/teams/${team_slug}/`,
      "DELETE",
    );
    return JSON.stringify({ removed: true });
  },
});
