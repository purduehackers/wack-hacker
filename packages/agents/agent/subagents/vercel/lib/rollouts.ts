import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── ROLLING RELEASES ────────────────

export const get_rolling_release = defineTool({
  description: "Get the current rolling release (if any) for a project.",
  access: { risk: "read" },
  input: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingRelease({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const get_rolling_release_config = defineTool({
  description: "Get the rolling release configuration (stages, thresholds) for a project.",
  access: { risk: "read" },
  input: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingReleaseConfig({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const get_rolling_release_billing_status = defineTool({
  description: "Check whether a project is eligible to use rolling releases (plan-gated).",
  access: { risk: "read" },
  input: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingReleaseBillingStatus({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const delete_rolling_release_config = defineTool({
  description: "Delete the rolling release configuration.",
  access: { risk: "destructive" },
  input: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.deleteRollingReleaseConfig({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const approve_rolling_release_stage = defineTool({
  description: "Advance an in-flight rolling release to the next stage. Shifts production traffic.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    canaryDeploymentId: z.string(),
    nextStageIndex: z.number(),
  }),
  execute: async ({ project_id_or_name, canaryDeploymentId, nextStageIndex }) => {
    const result = await vercel().rollingRelease.approveRollingReleaseStage({
      ...TEAM,
      idOrName: project_id_or_name,
      requestBody: { canaryDeploymentId, nextStageIndex },
    });
    return JSON.stringify(result);
  },
});

export const complete_rolling_release = defineTool({
  description: "Complete a rolling release — route 100% of traffic to the new deployment.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    canaryDeploymentId: z.string(),
  }),
  execute: async ({ project_id_or_name, canaryDeploymentId }) => {
    const result = await vercel().rollingRelease.completeRollingRelease({
      ...TEAM,
      idOrName: project_id_or_name,
      requestBody: { canaryDeploymentId },
    });
    return JSON.stringify(result);
  },
});

// ──────────────── DEPLOYMENT CHECKS (v2) ────────────────

export const list_project_checks = defineTool({
  description: "List deployment checks configured on a project.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    blocks: z
      .enum(["build-start", "deployment-start", "deployment-alias", "deployment-promotion", "none"])
      .optional(),
  }),
  execute: async ({ project_id_or_name, blocks }) => {
    const result = await vercel().checksV2.listProjectChecks({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      blocks,
    });
    return JSON.stringify(result);
  },
});

export const get_project_check = defineTool({
  description: "Get a deployment check by id.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    check_id: z.string(),
  }),
  execute: async ({ project_id_or_name, check_id }) => {
    const result = await vercel().checksV2.getProjectCheck({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      checkId: check_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_project_check = defineTool({
  description: "Delete a deployment check and all its runs.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    check_id: z.string(),
  }),
  execute: async ({ project_id_or_name, check_id }) => {
    const result = await vercel().checksV2.deleteProjectCheck({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      checkId: check_id,
    });
    return JSON.stringify(result);
  },
});

export const list_check_runs = defineTool({
  description: "List runs for a specific check.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    check_id: z.string(),
  }),
  execute: async ({ project_id_or_name, check_id }) => {
    const result = await vercel().checksV2.listCheckRuns({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      checkId: check_id,
    });
    return JSON.stringify(result);
  },
});

export const list_deployment_check_runs = defineTool({
  description: "List all check runs for a deployment.",
  access: { risk: "read" },
  input: z.object({
    deployment_id: z.string(),
  }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().checksV2.listDeploymentCheckRuns({
      ...TEAM,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});

export const get_deployment_check_run = defineTool({
  description: "Get a check run's details.",
  access: { risk: "read" },
  input: z.object({
    deployment_id: z.string(),
    check_run_id: z.string(),
  }),
  execute: async ({ deployment_id, check_run_id }) => {
    const result = await vercel().checksV2.getDeploymentCheckRun({
      ...TEAM,
      deploymentId: deployment_id,
      checkRunId: check_run_id,
    });
    return JSON.stringify(result);
  },
});
