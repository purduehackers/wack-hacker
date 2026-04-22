import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── TEAM ────────────────

export const get_team = tool({
  description: "Retrieve a team by id or slug.",
  inputSchema: z.object({
    team_id_or_slug: z.string().optional().describe("Defaults to the active team"),
  }),
  execute: async ({ team_id_or_slug }) => {
    const id = team_id_or_slug ?? VERCEL_TEAM_ID;
    const result = await vercel().teams.getTeam({ teamId: id });
    return JSON.stringify(result);
  },
});

// ──────────────── TEAM MEMBERS ────────────────

export const list_team_members = tool({
  description: "List members of the active team.",
  inputSchema: z.object({
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

export const remove_team_member = approval(
  tool({
    description: "Remove a member from the active team.",
    inputSchema: z.object({ uid: z.string(), newDefaultTeamId: z.string().optional() }),
    execute: async ({ uid, newDefaultTeamId }) => {
      const result = await vercel().teams.removeTeamMember({
        ...TEAM,
        uid,
        newDefaultTeamId,
      });
      return JSON.stringify(result);
    },
  }),
);

export const delete_team_invite_code = approval(
  tool({
    description: "Delete a pending team invite code.",
    inputSchema: z.object({ inviteId: z.string() }),
    execute: async ({ inviteId }) => {
      const result = await vercel().teams.deleteTeamInviteCode({
        ...TEAM,
        inviteId,
      });
      return JSON.stringify(result);
    },
  }),
);

// ──────────────── ACCESS GROUPS ────────────────

export const list_access_groups = tool({
  description: "List access groups on the team.",
  inputSchema: z.object({
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

export const get_access_group = tool({
  description: "Retrieve an access group by id or name.",
  inputSchema: z.object({ access_group_id_or_name: z.string() }),
  execute: async ({ access_group_id_or_name }) => {
    const result = await vercel().accessGroups.readAccessGroup({
      ...TEAM,
      idOrName: access_group_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const delete_access_group = approval(
  tool({
    description: "Delete an access group.",
    inputSchema: z.object({ access_group_id_or_name: z.string() }),
    execute: async ({ access_group_id_or_name }) => {
      await vercel().accessGroups.deleteAccessGroup({
        ...TEAM,
        idOrName: access_group_id_or_name,
      });
      return JSON.stringify({ ok: true, id: access_group_id_or_name });
    },
  }),
);

export const list_access_group_members = tool({
  description: "List members of an access group.",
  inputSchema: z.object({
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

export const list_webhooks = tool({
  description: "List team webhooks.",
  inputSchema: z.object({
    projectId: z.string().optional(),
  }),
  execute: async ({ projectId }) => {
    const result = await vercel().webhooks.getWebhooks({ ...TEAM, projectId });
    return JSON.stringify(result);
  },
});

export const get_webhook = tool({
  description: "Retrieve a team webhook by id.",
  inputSchema: z.object({ webhook_id: z.string() }),
  execute: async ({ webhook_id }) => {
    const result = await vercel().webhooks.getWebhook({ ...TEAM, id: webhook_id });
    return JSON.stringify(result);
  },
});

export const delete_webhook = approval(
  tool({
    description: "Delete a team webhook.",
    inputSchema: z.object({ webhook_id: z.string() }),
    execute: async ({ webhook_id }) => {
      await vercel().webhooks.deleteWebhook({ ...TEAM, id: webhook_id });
      return JSON.stringify({ ok: true, id: webhook_id });
    },
  }),
);

// ──────────────── PROJECT ROUTES ────────────────

export const list_project_routes = tool({
  description: "List routing rules for a project (from the Routing Middleware subsystem).",
  inputSchema: z.object({
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

export const list_project_route_versions = tool({
  description: "List historical versions of a project's routing rules.",
  inputSchema: z.object({
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

export const list_connect_networks = tool({
  description: "List Vercel Connect private networks on the team.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().connect.listNetworks({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const get_connect_network = tool({
  description: "Retrieve a Vercel Connect network by id.",
  inputSchema: z.object({ network_id: z.string() }),
  execute: async ({ network_id }) => {
    const result = await vercel().connect.readNetwork({
      ...TEAM,
      networkId: network_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_connect_network = approval(
  tool({
    description: "Delete a Vercel Connect private network.",
    inputSchema: z.object({ network_id: z.string() }),
    execute: async ({ network_id }) => {
      await vercel().connect.deleteNetwork({ ...TEAM, networkId: network_id });
      return JSON.stringify({ ok: true, id: network_id });
    },
  }),
);

// ──────────────── MICROFRONTENDS ────────────────

export const list_microfrontend_groups = tool({
  description: "List microfrontend groups on the team.",
  inputSchema: z.object({
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

export const list_billing_charges = tool({
  description:
    "List billing charges for the team between `from` and `to` (ISO 8601 UTC date-time strings).",
  inputSchema: z.object({
    from: z.string().describe("ISO 8601 UTC date-time — inclusive start"),
    to: z.string().describe("ISO 8601 UTC date-time — exclusive end"),
  }),
  execute: async ({ from, to }) => {
    const result = await vercel().billing.listBillingCharges({ ...TEAM, from, to });
    return JSON.stringify(result);
  },
});

export const list_contract_commitments = tool({
  description: "List contractual billing commitments.",
  inputSchema: z.object({
    limit: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().billing.listContractCommitments({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

// ──────────────── CUSTOM ENVIRONMENTS ────────────────

export const list_custom_environments = tool({
  description:
    "List custom preview environments for a project. Custom environments support per-branch URL schemes, custom domains, and environment-specific variables.",
  inputSchema: z.object({
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

export const get_custom_environment = tool({
  description: "Get a specific custom environment by id or slug.",
  inputSchema: z.object({
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

export const remove_custom_environment = approval(
  tool({
    description: "Remove a custom preview environment from a project.",
    inputSchema: z.object({
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
  }),
);
