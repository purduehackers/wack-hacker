import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { vercel } from "./client.ts";
import { TEAM } from "./constants.ts";
import { epochMillis, pageLimit } from "./fields.ts";
import { dropKeyDeep } from "./redact.ts";

const ENV_TARGETS = ["production", "preview", "development"] as const;
const ENV_TYPES = ["system", "encrypted", "plain", "sensitive"] as const;

/** Strip `value` from env var payloads. The Vercel SDK may return plaintext for `plain` scope. */
function redactEnvValues(input: unknown): unknown {
  return dropKeyDeep(input, "value");
}

export const list_projects = defineTool({
  description:
    "List Vercel projects in the active team. Supports `search`, `from` (timestamp cursor), `limit`, and repo filters.",
  access: { risk: "read" },
  input: z.strictObject({
    search: z.string().optional(),
    limit: pageLimit.max(100).optional(),
    from: epochMillis.optional().describe("Unix ms timestamp for pagination cursor"),
    repoUrl: z.url().optional().describe("Filter to projects linked to this git repository URL"),
    gitForkProtection: z.enum(["0", "1"]).optional(),
  }),
  execute: async ({ search, limit, from, repoUrl, gitForkProtection }) => {
    const result = await vercel().projects.getProjects({
      ...TEAM,
      search,
      limit: limit !== undefined ? String(limit) : undefined,
      from: from !== undefined ? String(from) : undefined,
      repoUrl,
      gitForkProtection,
    });
    return JSON.stringify(result);
  },
});

export const get_project = defineTool({
  description: "Retrieve a single Vercel project by id or name (via search).",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string().describe("Vercel project id (prj_…) or name"),
  }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().projects.getProjects({
      ...TEAM,
      search: project_id_or_name,
      limit: "1",
    });
    return JSON.stringify(result);
  },
});

export const delete_project = defineTool({
  description:
    "Permanently delete a Vercel project and every deployment underneath it. Irreversible.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    project_id_or_name: z.string(),
  }),
  execute: async ({ project_id_or_name }) => {
    await vercel().projects.deleteProject({ ...TEAM, idOrName: project_id_or_name });
    return JSON.stringify({ ok: true, id: project_id_or_name });
  },
});

export const pause_project = defineTool({
  description: "Pause a project. Blocks the active production deployment until unpaused.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id: z.string() }),
  execute: async ({ project_id }) => {
    await vercel().projects.pauseProject({ ...TEAM, projectId: project_id });
    return JSON.stringify({ ok: true, id: project_id, paused: true });
  },
});

export const unpause_project = defineTool({
  description: "Unpause a previously paused project. Restores the active production deployment.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id: z.string() }),
  execute: async ({ project_id }) => {
    await vercel().projects.unpauseProject({ ...TEAM, projectId: project_id });
    return JSON.stringify({ ok: true, id: project_id, paused: false });
  },
});

export const create_project_transfer_request = defineTool({
  description:
    "Create a project transfer request. Returns a `code` that another team can redeem within 24h to complete the transfer.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().projects.createProjectTransferRequest({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── ENV VARS ────────────────

export const list_project_env_vars = defineTool({
  description:
    "List environment variables for a project. **Always strips the `value` field** — returns keys, targets, types only. Use `get_project_env_var` to fetch a specific decrypted value.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    gitBranch: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, gitBranch }) => {
    const result = await vercel().projects.filterProjectEnvs({
      ...TEAM,
      idOrName: project_id_or_name,
      gitBranch,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});

export const get_project_env_var = defineTool({
  description:
    "Retrieve a single environment variable by its id, **including its decrypted value**. Use sparingly.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    env_var_id: z.string(),
  }),
  execute: async ({ project_id_or_name, env_var_id }) => {
    const result = await vercel().projects.getProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      id: env_var_id,
    });
    return JSON.stringify(result);
  },
});

export const create_project_env_vars = defineTool({
  description:
    "Create one or more environment variables on a project. Pass `upsert: true` to update-if-exists.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    upsert: z.boolean().optional(),
    entries: z
      .array(
        z.strictObject({
          key: z.string(),
          value: z.string(),
          type: z.enum(ENV_TYPES),
          target: z.array(z.enum(ENV_TARGETS)),
          gitBranch: z.string().optional(),
          comment: z.string().optional(),
        }),
      )
      .min(1),
  }),
  execute: async ({ project_id_or_name, upsert, entries }) => {
    const result = await vercel().projects.createProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      upsert: upsert ? "true" : undefined,
      requestBody: entries,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});

export const edit_project_env_var = defineTool({
  description: "Edit a single environment variable.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    env_var_id: z.string(),
    key: z.string().optional(),
    value: z.string().optional(),
    type: z.enum(ENV_TYPES).optional(),
    target: z.array(z.enum(ENV_TARGETS)).optional(),
    gitBranch: z.string().optional(),
    comment: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, env_var_id, ...patch }) => {
    const result = await vercel().projects.editProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      id: env_var_id,
      requestBody: patch,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});

export const remove_project_env_var = defineTool({
  description: "Remove a single environment variable from a project by its id.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    env_var_id: z.string(),
  }),
  execute: async ({ project_id_or_name, env_var_id }) => {
    const result = await vercel().projects.removeProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      id: env_var_id,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});

// ──────────────── DOMAINS ────────────────

export const list_project_domains = defineTool({
  description:
    "List domains attached to a project. Returns name, git branch binding, redirect, verification state.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    production: z.enum(["true", "false"]).optional(),
    target: z.enum(["production", "preview"]).optional(),
    customEnvironmentId: z.string().optional(),
    gitBranch: z.string().optional(),
    redirects: z.enum(["true", "false"]).optional(),
    redirect: z.string().optional(),
    verified: z.enum(["true", "false"]).optional(),
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  }),
  execute: async ({ project_id_or_name, ...query }) => {
    const result = await vercel().projects.getProjectDomains({
      ...TEAM,
      idOrName: project_id_or_name,
      ...query,
    });
    return JSON.stringify(result);
  },
});

export const get_project_domain = defineTool({
  description: "Get a single project domain's details.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    // Not `z.hostname()`: project domains may be wildcards (`*.purduehackers.com`).
    domain: z.string().describe("Project domain name, may be a wildcard like *.example.com"),
  }),
  execute: async ({ project_id_or_name, domain }) => {
    const result = await vercel().projects.getProjectDomain({
      ...TEAM,
      idOrName: project_id_or_name,
      domain,
    });
    return JSON.stringify(result);
  },
});

export const remove_project_domain = defineTool({
  description: "Remove a domain from a project.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    // Not `z.hostname()`: project domains may be wildcards (`*.purduehackers.com`).
    domain: z.string().describe("Project domain name, may be a wildcard like *.example.com"),
  }),
  execute: async ({ project_id_or_name, domain }) => {
    const result = await vercel().projects.removeProjectDomain({
      ...TEAM,
      idOrName: project_id_or_name,
      domain,
    });
    return JSON.stringify(result);
  },
});

export const verify_project_domain = defineTool({
  description: "Trigger verification of a pending project domain.",
  access: { risk: "write" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    // Not `z.hostname()`: project domains may be wildcards (`*.purduehackers.com`).
    domain: z.string().describe("Project domain name, may be a wildcard like *.example.com"),
  }),
  execute: async ({ project_id_or_name, domain }) => {
    const result = await vercel().projects.verifyProjectDomain({
      ...TEAM,
      idOrName: project_id_or_name,
      domain,
    });
    return JSON.stringify(result);
  },
});

export const list_promote_aliases = defineTool({
  description:
    "List aliases from the most recent promote request. Use after `promote_deployment` to confirm traffic moved.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async ({ project_id_or_name, limit, since, until }) => {
    const result = await vercel().projects.listPromoteAliases({
      ...TEAM,
      projectId: project_id_or_name,
      limit,
      since,
      until,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── MEMBERS ────────────────

export const list_project_members = defineTool({
  description: "List members with access to a specific project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    search: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, limit, since, until, search }) => {
    const result = await vercel().projectMembers.getProjectMembers({
      ...TEAM,
      idOrName: project_id_or_name,
      limit,
      since,
      until,
      search,
    });
    return JSON.stringify(result);
  },
});

export const remove_project_member = defineTool({
  description: "Remove a member from a project.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    uid: z.string(),
  }),
  execute: async ({ project_id_or_name, uid }) => {
    const result = await vercel().projectMembers.removeProjectMember({
      ...TEAM,
      idOrName: project_id_or_name,
      uid,
    });
    return JSON.stringify(result);
  },
});
