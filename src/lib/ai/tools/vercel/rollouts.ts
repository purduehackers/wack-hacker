import { tool } from "ai";
import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── ROLLING RELEASES ────────────────

export const get_rolling_release = tool({
  description: "Get the current rolling release (if any) for a project.",
  inputSchema: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingRelease({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const get_rolling_release_config = tool({
  description: "Get the rolling release configuration (stages, thresholds) for a project.",
  inputSchema: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingReleaseConfig({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const get_rolling_release_billing_status = tool({
  description: "Check whether a project is eligible to use rolling releases (plan-gated).",
  inputSchema: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingReleaseBillingStatus({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Deletes the rolling-release config — future prod deploys ship 100% immediately. */
export const delete_rolling_release_config = tool({
  description: "Delete the rolling release configuration.",
  inputSchema: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.deleteRollingReleaseConfig({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Approves the next stage of an in-flight rolling release. Shifts production traffic. */
export const approve_rolling_release_stage = tool({
  description: "Advance an in-flight rolling release to the next stage. Shifts production traffic.",
  inputSchema: z.object({
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

/** @destructive Completes the rolling release by routing 100% of traffic to the new deployment. */
export const complete_rolling_release = tool({
  description: "Complete a rolling release — route 100% of traffic to the new deployment.",
  inputSchema: z.object({
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

export const list_project_checks = tool({
  description: "List deployment checks configured on a project.",
  inputSchema: z.object({
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

export const get_project_check = tool({
  description: "Get a deployment check by id.",
  inputSchema: z.object({
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

/** @destructive Deletes a deployment check and all its runs. */
export const delete_project_check = tool({
  description: "Delete a deployment check and all its runs.",
  inputSchema: z.object({
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

export const list_check_runs = tool({
  description: "List runs for a specific check.",
  inputSchema: z.object({
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

export const list_deployment_check_runs = tool({
  description: "List all check runs for a deployment.",
  inputSchema: z.object({
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

export const get_deployment_check_run = tool({
  description: "Get a check run's details.",
  inputSchema: z.object({
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
