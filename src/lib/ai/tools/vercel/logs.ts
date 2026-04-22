import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── RUNTIME LOGS ────────────────

export const get_runtime_logs = tool({
  description:
    "Fetch runtime logs for a specific deployment. Returns platform/runtime logs (cold starts, function invocation, timeouts). For application errors, prefer the Sentry subagent.",
  inputSchema: z.object({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    const result = await vercel().logs.getRuntimeLogs({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── LOG DRAINS ────────────────

export const list_log_drains = tool({
  description: "List every configurable log drain on the team.",
  inputSchema: z.object({
    projectId: z.string().optional(),
    projectIdOrName: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().logDrains.getAllLogDrains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_log_drain = tool({
  description: "Retrieve a configurable log drain by id.",
  inputSchema: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    const result = await vercel().logDrains.getConfigurableLogDrain({ ...TEAM, id: drain_id });
    return JSON.stringify(result);
  },
});

export const delete_configurable_log_drain = approval(
  tool({
    description: "Delete a configurable log drain.",
    inputSchema: z.object({ drain_id: z.string() }),
    execute: async ({ drain_id }) => {
      await vercel().logDrains.deleteConfigurableLogDrain({ ...TEAM, id: drain_id });
      return JSON.stringify({ ok: true, id: drain_id });
    },
  }),
);

export const list_integration_log_drains = tool({
  description: "List integration-backed log drains (created by installed integrations).",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().logDrains.getIntegrationLogDrains({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const delete_integration_log_drain = approval(
  tool({
    description: "Delete an integration log drain.",
    inputSchema: z.object({ drain_id: z.string() }),
    execute: async ({ drain_id }) => {
      await vercel().logDrains.deleteIntegrationLogDrain({ ...TEAM, id: drain_id });
      return JSON.stringify({ ok: true, id: drain_id });
    },
  }),
);

// ──────────────── DRAINS (newer generic API) ────────────────

export const list_drains = tool({
  description:
    "List every data drain (the newer generic drain API — supports logs, traces, metrics).",
  inputSchema: z.object({
    projectId: z.string().optional(),
    environments: z.array(z.string()).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().drains.getDrains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_drain = tool({
  description: "Retrieve a drain by id.",
  inputSchema: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    const result = await vercel().drains.getDrain({ ...TEAM, id: drain_id });
    return JSON.stringify(result);
  },
});

export const delete_drain = approval(
  tool({
    description: "Delete a data drain.",
    inputSchema: z.object({ drain_id: z.string() }),
    execute: async ({ drain_id }) => {
      await vercel().drains.deleteDrain({ ...TEAM, id: drain_id });
      return JSON.stringify({ ok: true, id: drain_id });
    },
  }),
);

// ──────────────── OBSERVABILITY ────────────────

export const get_observability_config = tool({
  description: "Retrieve the API Observability configuration for the team.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().apiObservability.getObservabilityConfigurationProjects({
      ...TEAM,
    });
    return JSON.stringify(result);
  },
});

export const update_observability_config = tool({
  description: "Update the API Observability Plus setting (enabled/disabled) for a project.",
  inputSchema: z.object({
    project_id_or_name: z.string(),
    disabled: z.boolean(),
  }),
  execute: async ({ project_id_or_name, disabled }) => {
    const result = await vercel().apiObservability.updateObservabilityConfigurationProject({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { disabled },
    });
    return JSON.stringify(result);
  },
});

// ──────────────── ARTIFACTS (Turborepo remote cache) ────────────────

export const artifacts_status = tool({
  description: "Get the Turborepo remote cache status for the team (enabled? usage?).",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().artifacts.status({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const artifact_exists = tool({
  description: "Check whether a Turborepo artifact with the given hash exists.",
  inputSchema: z.object({ hash: z.string() }),
  execute: async ({ hash }) => {
    await vercel().artifacts.artifactExists({ ...TEAM, hash });
    return JSON.stringify({ exists: true, hash });
  },
});

export const artifact_query = tool({
  description: "Query Turborepo artifact events and usage statistics by hashes.",
  inputSchema: z.object({
    hashes: z.array(z.string()).min(1),
  }),
  execute: async ({ hashes }) => {
    const result = await vercel().artifacts.artifactQuery({
      ...TEAM,
      requestBody: { hashes },
    });
    return JSON.stringify(result);
  },
});
