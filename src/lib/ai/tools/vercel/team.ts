import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── TEAM ────────────────

export const get_team = defineTool({
  name: "get_team",
  domain: "vercel",
  description: "Retrieve a team by id or slug.",
  access: { risk: "read" },
  input: z.object({
    team_id_or_slug: z.string().optional().describe("Defaults to the active team"),
  }),
  execute: async ({ team_id_or_slug }) => {
    const id = team_id_or_slug ?? VERCEL_TEAM_ID;
    const result = await vercel().teams.getTeam({ teamId: id });
    return JSON.stringify(result);
  },
});

// ──────────────── TEAM MEMBERS ────────────────

export const list_team_members = defineTool({
  name: "list_team_members",
  domain: "vercel",
  description: "List members of the active team.",
  access: { risk: "read" },
  input: z.object({
    limit: z.number().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
    role: z.enum(["OWNER", "MEMBER", "DEVELOPER", "VIEWER", "BILLING", "CONTRIBUTOR"]).optional(),
    excludeProject: z.string().optional(),
    eligibleMembersForProjectId: z.string().optional(),
    search: z.string().optional(),
  }),
  execute: async ({
    limit,
    since,
    until,
    role,
    excludeProject,
    eligibleMembersForProjectId,
    search,
  }) => {
    const result = await vercel().teams.getTeamMembers({
      teamId: VERCEL_TEAM_ID,
      slug: VERCEL_TEAM_SLUG,
      limit,
      since,
      until,
      role,
      excludeProject,
      eligibleMembersForProjectId,
      search,
    });
    return JSON.stringify(result);
  },
});

export const remove_team_member = defineTool({
  name: "remove_team_member",
  domain: "vercel",
  description: "Remove a member from the active team.",
  access: { risk: "destructive" },
  input: z.object({ uid: z.string(), newDefaultTeamId: z.string().optional() }),
  execute: async ({ uid, newDefaultTeamId }) => {
    const result = await vercel().teams.removeTeamMember({
      ...TEAM,
      uid,
      newDefaultTeamId,
    });
    return JSON.stringify(result);
  },
});

export const delete_team_invite_code = defineTool({
  name: "delete_team_invite_code",
  domain: "vercel",
  description: "Delete a pending team invite code.",
  access: { risk: "destructive" },
  input: z.object({ inviteId: z.string() }),
  execute: async ({ inviteId }) => {
    const result = await vercel().teams.deleteTeamInviteCode({
      ...TEAM,
      inviteId,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── ACCESS GROUPS ────────────────

export const list_access_groups = defineTool({
  name: "list_access_groups",
  domain: "vercel",
  description: "List access groups on the team.",
  access: { risk: "read" },
  input: z.object({
    projectId: z.string().optional(),
    search: z.string().optional(),
    membersLimit: z.number().optional(),
    projectsLimit: z.number().optional(),
    limit: z.number().optional(),
    next: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().accessGroups.listAccessGroups({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_access_group = defineTool({
  name: "get_access_group",
  domain: "vercel",
  description: "Retrieve an access group by id or name.",
  access: { risk: "read" },
  input: z.object({ access_group_id_or_name: z.string() }),
  execute: async ({ access_group_id_or_name }) => {
    const result = await vercel().accessGroups.readAccessGroup({
      ...TEAM,
      idOrName: access_group_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const delete_access_group = defineTool({
  name: "delete_access_group",
  domain: "vercel",
  description: "Delete an access group.",
  access: { risk: "destructive" },
  input: z.object({ access_group_id_or_name: z.string() }),
  execute: async ({ access_group_id_or_name }) => {
    await vercel().accessGroups.deleteAccessGroup({
      ...TEAM,
      idOrName: access_group_id_or_name,
    });
    return JSON.stringify({ ok: true, id: access_group_id_or_name });
  },
});

export const list_access_group_members = defineTool({
  name: "list_access_group_members",
  domain: "vercel",
  description: "List members of an access group.",
  access: { risk: "read" },
  input: z.object({
    access_group_id_or_name: z.string(),
    limit: z.number().optional(),
    next: z.string().optional(),
  }),
  execute: async ({ access_group_id_or_name, limit, next }) => {
    const result = await vercel().accessGroups.listAccessGroupMembers({
      ...TEAM,
      idOrName: access_group_id_or_name,
      limit,
      next,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── WEBHOOKS ────────────────

export const list_webhooks = defineTool({
  name: "list_webhooks",
  domain: "vercel",
  description: "List team webhooks.",
  access: { risk: "read" },
  input: z.object({
    projectId: z.string().optional(),
  }),
  execute: async ({ projectId }) => {
    const result = await vercel().webhooks.getWebhooks({ ...TEAM, projectId });
    return JSON.stringify(result);
  },
});

export const get_webhook = defineTool({
  name: "get_webhook",
  domain: "vercel",
  description: "Retrieve a team webhook by id.",
  access: { risk: "read" },
  input: z.object({ webhook_id: z.string() }),
  execute: async ({ webhook_id }) => {
    const result = await vercel().webhooks.getWebhook({ ...TEAM, id: webhook_id });
    return JSON.stringify(result);
  },
});

export const delete_webhook = defineTool({
  name: "delete_webhook",
  domain: "vercel",
  description: "Delete a team webhook.",
  access: { risk: "destructive" },
  input: z.object({ webhook_id: z.string() }),
  execute: async ({ webhook_id }) => {
    await vercel().webhooks.deleteWebhook({ ...TEAM, id: webhook_id });
    return JSON.stringify({ ok: true, id: webhook_id });
  },
});

// ──────────────── PROJECT ROUTES ────────────────

export const list_project_routes = defineTool({
  name: "list_project_routes",
  domain: "vercel",
  description: "List routing rules for a project (from the Routing Middleware subsystem).",
  access: { risk: "read" },
  input: z.object({
    project_id: z.string(),
  }),
  execute: async ({ project_id }) => {
    const result = await vercel().projectRoutes.getRoutes({
      ...TEAM,
      projectId: project_id,
    });
    return JSON.stringify(result);
  },
});

export const list_project_route_versions = defineTool({
  name: "list_project_route_versions",
  domain: "vercel",
  description: "List historical versions of a project's routing rules.",
  access: { risk: "read" },
  input: z.object({
    project_id: z.string(),
  }),
  execute: async ({ project_id }) => {
    const result = await vercel().projectRoutes.getRouteVersions({
      ...TEAM,
      projectId: project_id,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── CONNECT NETWORKS ────────────────

export const list_connect_networks = defineTool({
  name: "list_connect_networks",
  domain: "vercel",
  description: "List Vercel Connect private networks on the team.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().connect.listNetworks({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const get_connect_network = defineTool({
  name: "get_connect_network",
  domain: "vercel",
  description: "Retrieve a Vercel Connect network by id.",
  access: { risk: "read" },
  input: z.object({ network_id: z.string() }),
  execute: async ({ network_id }) => {
    const result = await vercel().connect.readNetwork({
      ...TEAM,
      networkId: network_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_connect_network = defineTool({
  name: "delete_connect_network",
  domain: "vercel",
  description: "Delete a Vercel Connect private network.",
  access: { risk: "destructive" },
  input: z.object({ network_id: z.string() }),
  execute: async ({ network_id }) => {
    await vercel().connect.deleteNetwork({ ...TEAM, networkId: network_id });
    return JSON.stringify({ ok: true, id: network_id });
  },
});

// ──────────────── MICROFRONTENDS ────────────────

export const list_microfrontend_groups = defineTool({
  name: "list_microfrontend_groups",
  domain: "vercel",
  description: "List microfrontend groups on the team.",
  access: { risk: "read" },
  input: z.object({
    limit: z.string().optional(),
    since: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().microfrontends.getMicrofrontendsGroups({
      ...TEAM,
      ...input,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── BILLING ────────────────

export const list_billing_charges = defineTool({
  name: "list_billing_charges",
  domain: "vercel",
  description:
    "List billing charges for the team between `from` and `to` (ISO 8601 UTC date-time strings).",
  access: { risk: "read" },
  input: z.object({
    from: z.string().describe("ISO 8601 UTC date-time — inclusive start"),
    to: z.string().describe("ISO 8601 UTC date-time — exclusive end"),
  }),
  execute: async ({ from, to }) => {
    const result = await vercel().billing.listBillingCharges({ ...TEAM, from, to });
    return JSON.stringify(result);
  },
});

export const list_contract_commitments = defineTool({
  name: "list_contract_commitments",
  domain: "vercel",
  description: "List contractual billing commitments.",
  access: { risk: "read" },
  input: z.object({
    limit: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().billing.listContractCommitments({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

// ──────────────── CUSTOM ENVIRONMENTS ────────────────

export const list_custom_environments = defineTool({
  name: "list_custom_environments",
  domain: "vercel",
  description:
    "List custom preview environments for a project. Custom environments support per-branch URL schemes, custom domains, and environment-specific variables.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    gitBranch: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, gitBranch }) => {
    const result = await vercel().environment.getProjectsByIdOrNameCustomEnvironments({
      ...TEAM,
      idOrName: project_id_or_name,
      gitBranch,
    });
    return JSON.stringify(result);
  },
});

export const get_custom_environment = defineTool({
  name: "get_custom_environment",
  domain: "vercel",
  description: "Get a specific custom environment by id or slug.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    environment_id_or_slug: z.string(),
  }),
  execute: async ({ project_id_or_name, environment_id_or_slug }) => {
    const result = await vercel().environment.getCustomEnvironment({
      ...TEAM,
      idOrName: project_id_or_name,
      environmentSlugOrId: environment_id_or_slug,
    });
    return JSON.stringify(result);
  },
});

export const remove_custom_environment = defineTool({
  name: "remove_custom_environment",
  domain: "vercel",
  description: "Remove a custom preview environment from a project.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    environment_id_or_slug: z.string(),
    deleteUnassignedEnvironmentVariables: z.boolean().optional(),
  }),
  execute: async ({
    project_id_or_name,
    environment_id_or_slug,
    deleteUnassignedEnvironmentVariables,
  }) => {
    const result = await vercel().environment.removeCustomEnvironment({
      ...TEAM,
      idOrName: project_id_or_name,
      environmentSlugOrId: environment_id_or_slug,
      requestBody: { deleteUnassignedEnvironmentVariables },
    });
    return JSON.stringify(result);
  },
});
