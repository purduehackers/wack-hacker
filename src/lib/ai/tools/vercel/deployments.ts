import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

export const list_deployments = defineTool({
  name: "list_deployments",
  domain: "vercel",
  description:
    "List deployments for the active team. Optional filters: `projectId`, `target` (production/preview), `state` (comma-separated states like 'BUILDING,READY'), branch/commit, and time window. Paginate with `from`, `to`, `until`, `since`, and `limit`.",
  access: { risk: "read" },
  input: z.object({
    projectId: z.string().optional(),
    app: z.string().optional().describe("Project name"),
    target: z.enum(["production", "preview"]).optional(),
    state: z.string().optional(),
    limit: z.number().max(100).optional(),
    from: z.number().optional().describe("Unix ms lower bound (cursor)"),
    to: z.number().optional().describe("Unix ms upper bound (cursor)"),
    since: z.number().optional(),
    until: z.number().optional(),
    users: z.string().optional().describe("Comma-separated creator user ids"),
    branch: z.string().optional(),
    sha: z.string().optional(),
    rollbackCandidate: z.boolean().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().deployments.getDeployments({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_deployment = defineTool({
  name: "get_deployment",
  domain: "vercel",
  description:
    "Retrieve a deployment by its id (dpl_…) or URL hostname. Returns full metadata, build info, creator, alias assignment, commit details.",
  access: { risk: "read" },
  input: z.object({
    id_or_url: z.string().describe("Deployment id (dpl_…) or hostname (my-app-abc123.vercel.app)"),
    withGitRepoInfo: z.enum(["true", "false"]).optional(),
  }),
  execute: async ({ id_or_url, withGitRepoInfo }) => {
    const result = await vercel().deployments.getDeployment({
      ...TEAM,
      idOrUrl: id_or_url,
      withGitRepoInfo,
    });
    return JSON.stringify(result);
  },
});

export const get_deployment_events = defineTool({
  name: "get_deployment_events",
  domain: "vercel",
  description:
    "Fetch build events / logs for a deployment in JSON mode. Returns an array of events (stdout, stderr, stage transitions). Hard-capped at `limit` (max 200).",
  access: { risk: "read" },
  input: z.object({
    deployment_id: z.string(),
    limit: z.number().max(200).optional(),
    since: z.number().optional(),
    until: z.number().optional(),
    follow: z.number().optional().describe("1 to follow (stream); 0 for one-shot"),
    builds: z.number().optional(),
    direction: z.enum(["backward", "forward"]).optional(),
    name: z.string().optional(),
    statusCode: z.string().optional(),
    delimiter: z.number().optional(),
  }),
  execute: async ({ deployment_id, limit, ...query }) => {
    const cappedLimit = limit !== undefined ? Math.min(limit, 200) : 200;
    const result = await vercel().deployments.getDeploymentEvents({
      ...TEAM,
      idOrUrl: deployment_id,
      ...query,
      limit: cappedLimit,
    });
    return JSON.stringify(result);
  },
});

export const list_deployment_files = defineTool({
  name: "list_deployment_files",
  domain: "vercel",
  description: "List the file tree of a deployment's source code.",
  access: { risk: "read" },
  input: z.object({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().deployments.listDeploymentFiles({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});

export const get_deployment_file_contents = defineTool({
  name: "get_deployment_file_contents",
  domain: "vercel",
  description: "Get the contents of a specific file from a deployment. Response is base64-encoded.",
  access: { risk: "read" },
  input: z.object({
    deployment_id: z.string(),
    file_id: z.string(),
    path: z.string().optional(),
  }),
  execute: async ({ deployment_id, file_id, path }) => {
    const result = await vercel().deployments.getDeploymentFileContents({
      ...TEAM,
      id: deployment_id,
      fileId: file_id,
      path,
    });
    return JSON.stringify(result);
  },
});

export const cancel_deployment = defineTool({
  name: "cancel_deployment",
  domain: "vercel",
  description:
    "Cancel an in-flight deployment (state must be BUILDING / QUEUED / INITIALIZING). Returns the deployment's new state.",
  access: { risk: "destructive" },
  input: z.object({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().deployments.cancelDeployment({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});

export const delete_deployment = defineTool({
  name: "delete_deployment",
  domain: "vercel",
  description:
    "Permanently delete a deployment by id or URL. Irreversible. Cannot be used on the active production deployment.",
  access: { risk: "destructive" },
  input: z.object({
    id_or_url: z.string(),
    url: z.string().optional(),
  }),
  execute: async ({ id_or_url, url }) => {
    const result = await vercel().deployments.deleteDeployment({
      ...TEAM,
      id: id_or_url,
      url,
    });
    return JSON.stringify(result);
  },
});

export const update_integration_deployment_action = defineTool({
  name: "update_integration_deployment_action",
  domain: "vercel",
  description: "Update the deployment integration action state for a specific integration install.",
  access: { risk: "write" },
  input: z.object({
    deployment_id: z.string(),
    integrationConfigurationId: z.string(),
    resourceId: z.string(),
    action: z.string(),
  }),
  execute: async ({ deployment_id, integrationConfigurationId, resourceId, action }) => {
    await vercel().deployments.updateIntegrationDeploymentAction({
      ...TEAM,
      deploymentId: deployment_id,
      integrationConfigurationId,
      resourceId,
      action,
    });
    return JSON.stringify({ ok: true });
  },
});

// ──────────────── PROMOTE / ROLLBACK ────────────────
// Lives on the `projects` module in the Vercel SDK but semantically operates on deployments.

export const promote_deployment = defineTool({
  name: "promote_deployment",
  domain: "vercel",
  description:
    "Promote a deployment to production without rebuilding it. Returns immediately; the actual traffic shift is async — check `list_promote_aliases` for status.",
  access: { risk: "destructive" },
  input: z.object({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    await vercel().projects.requestPromote({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify({
      ok: true,
      projectId: project_id,
      deploymentId: deployment_id,
      note: "Promote request accepted. Poll list_promote_aliases for traffic status.",
    });
  },
});

export const rollback_deployment = defineTool({
  name: "rollback_deployment",
  domain: "vercel",
  description:
    "Roll production traffic back to an older deployment. Async — check `list_promote_aliases` for completion.",
  access: { risk: "destructive" },
  input: z.object({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    await vercel().projects.requestRollback({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify({
      ok: true,
      projectId: project_id,
      deploymentId: deployment_id,
      note: "Rollback request accepted. Poll list_promote_aliases for traffic status.",
    });
  },
});

export const update_rollback_description = defineTool({
  name: "update_rollback_description",
  domain: "vercel",
  description: "Update the description (reason) attached to an active rollback.",
  access: { risk: "write" },
  input: z.object({
    project_id: z.string(),
    deployment_id: z.string(),
    description: z.string(),
  }),
  execute: async ({ project_id, deployment_id, description }) => {
    await vercel().projects.updateProjectsByProjectIdRollbackByDeploymentIdUpdateDescription({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
      requestBody: { description },
    });
    return JSON.stringify({ ok: true });
  },
});
